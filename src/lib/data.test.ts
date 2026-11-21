import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, cleanSettings, makeBackup, parseBackup, type AppData } from './data';
import * as db from './db';
import { planImport } from './importer';
import { schedule, type ReviewLog } from './scheduler';

const NOW = new Date(2026, 5, 15, 12).getTime();

function sampleData(): AppData {
  const plan = planImport([], () => false, [{ path: 'bio/cells.md', text: 'q1 :: a1\nThe ==x== y\nQ: q2\nA: a2' }]);
  const [a, b] = plan.upsert;
  return {
    cards: plan.upsert,
    states: new Map([[a!.id, schedule(undefined, 3, NOW, 0.9)], [b!.id, schedule(undefined, 4, NOW, 0.9)]]),
    logs: [{ id: a!.id, t: NOW, rating: 3, state: 0 }, { id: b!.id, t: NOW + 1, rating: 4, state: 0 }],
    settings: { dailyGoal: 30, newPerDay: 5, retention: 0.85, headings: true },
  };
}

describe('backup', () => {
  it('round-trips through JSON', () => {
    const data = sampleData();
    const json = JSON.stringify(makeBackup(data, NOW));
    expect(parseBackup(json)).toEqual(data);
    expect(JSON.parse(json)).toMatchObject({ app: 'recallmd', version: 1, exportedAt: new Date(NOW).toISOString() });
  });

  const broken = (change: (b: Record<string, any>) => void) => {
    const b = JSON.parse(JSON.stringify(makeBackup(sampleData(), NOW)));
    change(b);
    return JSON.stringify(b);
  };

  it.each([
    ['not json', '{oops', 'not valid JSON'],
    ['an array', '[]', 'not a recallmd backup'],
    ['another app', '{"app":"anki"}', 'not a recallmd backup'],
    ['a future version', broken((b) => (b.version = 2)), 'version 2 is not supported'],
    ['a card without an id', broken((b) => delete b.cards[0].id), 'damaged cards'],
    ['a card without a position', broken((b) => delete b.cards[0].seq), 'damaged cards'],
    ['a card of unknown kind', broken((b) => (b.cards[0].kind = 'x')), 'damaged cards'],
    ['duplicate cards', broken((b) => b.cards.push(b.cards[0])), 'duplicate cards'],
    ['a non-numeric due date', broken((b) => (Object.values<any>(b.states)[0].due = '2026')), 'damaged scheduling'],
    ['an impossible state', broken((b) => (Object.values<any>(b.states)[0].state = 9)), 'damaged scheduling'],
    ['a negative stability', broken((b) => (Object.values<any>(b.states)[0].stability = -10)), 'damaged scheduling'],
    ['a difficulty below the scale', broken((b) => (Object.values<any>(b.states)[0].difficulty = 0)), 'damaged scheduling'],
    ['a date no calendar can hold', broken((b) => (Object.values<any>(b.states)[0].last_review = 1e100)), 'damaged scheduling'],
    ['a review at a negative time', broken((b) => (b.logs[0].t = -1)), 'damaged review history'],
    ['states as a list', broken((b) => (b.states = [])), 'damaged scheduling'],
    ['an impossible rating', broken((b) => (b.logs[0].rating = 5)), 'damaged review history'],
    ['missing logs', broken((b) => delete b.logs), 'damaged review history'],
  ])('rejects %s', (_name, json, message) => {
    expect(() => parseBackup(json)).toThrow(message);
  });

  it('accepts every state the scheduler itself can produce', () => {
    const data = sampleData();
    let state = schedule(undefined, 1, NOW, 0.9);
    for (const rating of [1, 2, 3, 4, 3, 1, 3, 3, 4, 2] as const) {
      data.states.set(data.cards[0]!.id, state);
      expect(parseBackup(JSON.stringify(makeBackup(data, NOW))).states.get(data.cards[0]!.id)).toEqual(state);
      state = schedule(state, rating, state.due + 3 * 86_400_000, 0.9);
    }
  });

  it('repairs settings instead of rejecting the file', () => {
    expect(parseBackup(broken((b) => (b.settings = { dailyGoal: -5, retention: 2 }))).settings).toEqual({
      ...DEFAULT_SETTINGS, dailyGoal: 1, retention: 0.97,
    });
  });
});

describe('cleanSettings', () => {
  it('falls back to defaults for anything missing or of the wrong type', () => {
    expect(cleanSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ dailyGoal: '50', newPerDay: NaN, retention: null, headings: 'yes' })).toEqual(DEFAULT_SETTINGS);
  });

  it('rounds and clamps numbers', () => {
    expect(cleanSettings({ dailyGoal: 12.6, newPerDay: -1, retention: 0.5, headings: true })).toEqual({
      dailyGoal: 13, newPerDay: 0, retention: 0.7, headings: true,
    });
  });
});

// One sequence against a single fake database, since the tests build on each other.
describe('db', () => {
  it('starts empty with default settings', async () => {
    expect(await db.loadAll()).toEqual({ cards: [], states: new Map(), logs: [], settings: DEFAULT_SETTINGS, sampleLoaded: false });
  });

  it('stores an import, a review, and takes the review back', async () => {
    const plan = planImport([], () => false, [{ path: 'a.md', text: 'q1 :: a1\nq2 :: a2' }]);
    await db.applyImport(plan, new Map());
    const id = plan.upsert[0]!.id;
    const first = schedule(undefined, 3, NOW, 0.9);
    const log: ReviewLog = { id, t: NOW, rating: 3, state: 0 };
    await db.saveReview(first, log);

    const second = schedule(first, 3, first.due, 0.9);
    const key = await db.saveReview(second, { id, t: first.due, rating: 3, state: first.state });
    let data = await db.loadAll();
    expect(data.cards.map((c) => c.front)).toEqual(['q1', 'q2']); // note order, not id order
    expect(data.states).toEqual(new Map([[id, second]]));
    expect(data.logs).toHaveLength(2);

    await db.undoReview(id, first, key);
    data = await db.loadAll();
    expect(data.states).toEqual(new Map([[id, first]]));
    expect(data.logs).toEqual([log]);
  });

  it('undoing the first review of a card makes it new again', async () => {
    const { cards } = await db.loadAll();
    const id = cards.find((c) => c.front === 'q2')!.id;
    const key = await db.saveReview(schedule(undefined, 1, NOW, 0.9), { id, t: NOW, rating: 1, state: 0 });
    await db.undoReview(id, undefined, key);
    const data = await db.loadAll();
    expect(data.states.has(id)).toBe(false);
    expect(data.logs).toHaveLength(1);
  });

  it('moves progress to a reworded card and removes the old one on re-import', async () => {
    const before = await db.loadAll();
    const old = before.cards.find((c) => c.front === 'q1')!;
    const plan = planImport(before.cards, (id) => before.states.has(id), [{ path: 'a.md', text: 'q1! :: a1\nq2 :: a2' }]);
    expect(plan.moves).toHaveLength(1);
    await db.applyImport(plan, before.states);
    const after = await db.loadAll();
    const reworded = after.cards.find((c) => c.front === 'q1!')!;
    expect(after.cards).toHaveLength(2);
    expect(after.states).toEqual(new Map([[reworded.id, before.states.get(old.id)]]));
  });

  it('keeps progress when cards are deleted, so importing them again restores it', async () => {
    const before = await db.loadAll();
    await db.deleteCards(before.cards.map((c) => c.id));
    const after = await db.loadAll();
    expect(after.cards).toEqual([]);
    expect(after.states).toEqual(before.states);
  });

  it('saves settings and the sample flag', async () => {
    await db.saveSettings({ ...DEFAULT_SETTINGS, dailyGoal: 42 });
    await db.markSampleLoaded();
    expect(await db.loadAll()).toMatchObject({ settings: { dailyGoal: 42 }, sampleLoaded: true });
  });

  it('restores a backup over whatever was there', async () => {
    const data = sampleData();
    await db.replaceAll(data);
    expect(await db.loadAll()).toEqual({ ...data, sampleLoaded: true });
  });

  it('wipes everything but does not bring the sample deck back', async () => {
    await db.replaceAll();
    expect(await db.loadAll()).toEqual({ cards: [], states: new Map(), logs: [], settings: DEFAULT_SETTINGS, sampleLoaded: true });
  });
});
