import { describe, expect, it } from 'vitest';
import type { Card } from './parser';
import {
  DAY, LEARNING, NEW, RELEARNING, REVIEW,
  afterAnswer, buildQueue, formatInterval, newSeenToday, pickNext, previewIntervals, schedule,
  startOfDay, startOfNextDay, syncQueue,
  type CardState, type QueueItem, type Rating, type ReviewLog,
} from './scheduler';

const MIN = 60_000;
/** Noon, local time, on a fixed day. */
const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime();
const R = 0.9;

const card = (id: string): Card => ({ id, kind: 'basic', front: id, back: '', deck: 'd', tags: [], source: 'd.md', line: 1, seq: 0 });

/** Answers a card repeatedly, each time at the moment it comes due. */
function review(ratings: Rating[], retention = R): CardState {
  let state: CardState | undefined;
  let now = NOON;
  for (const r of ratings) {
    state = schedule(state, r, now, retention);
    now = state.due;
  }
  return state!;
}

describe('schedule', () => {
  it('puts a new card answered Again, Hard or Good into a short learning step', () => {
    for (const rating of [1, 2, 3] as const) {
      const s = schedule(undefined, rating, NOON, R);
      expect(s.state).toBe(LEARNING);
      expect(s.due - NOON).toBeGreaterThan(0);
      expect(s.due - NOON).toBeLessThan(DAY);
    }
  });

  it('graduates a new card answered Easy straight to review, days out', () => {
    const s = schedule(undefined, 4, NOON, R);
    expect(s.state).toBe(REVIEW);
    expect(s.due - NOON).toBeGreaterThanOrEqual(DAY);
  });

  it('orders the four ratings: Again soonest, Easy latest', () => {
    for (const state of [undefined, review([3, 3]), review([3, 3, 3, 3])]) {
      const now = state?.due ?? NOON;
      const p = previewIntervals(state, now, R);
      expect(p[1]).toBeLessThan(p[2]);
      expect(p[2]).toBeLessThanOrEqual(p[3]);
      expect(p[3]).toBeLessThan(p[4]);
    }
  });

  it('records the review on the card', () => {
    const s = schedule(undefined, 3, NOON, R);
    expect(s).toMatchObject({ reps: 1, lapses: 0, last_review: NOON });
    expect(s.stability).toBeGreaterThan(0);
    expect(s.difficulty).toBeGreaterThanOrEqual(1);
    expect(s.difficulty).toBeLessThanOrEqual(10);
  });

  it('graduates to review after the learning steps and grows the interval with each Good', () => {
    const intervals: number[] = [];
    let state: CardState | undefined;
    let now = NOON;
    for (let i = 0; i < 7; i++) {
      state = schedule(state, 3, now, R);
      if (state.state === REVIEW) intervals.push(state.due - now);
      now = state.due;
    }
    expect(state!.state).toBe(REVIEW);
    expect(intervals.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]!).toBeGreaterThan(intervals[i - 1]!);
  });

  it('a lapse counts, drops stability and sends the card to relearning', () => {
    const before = review([3, 3, 3, 3, 3]);
    expect(before.state).toBe(REVIEW);
    const after = schedule(before, 1, before.due, R);
    expect(after.state).toBe(RELEARNING);
    expect(after.lapses).toBe(1);
    expect(after.stability).toBeLessThan(before.stability);
    expect(after.difficulty).toBeGreaterThan(before.difficulty);
    expect(after.due - before.due).toBeLessThan(DAY);
  });

  it('Easy lowers difficulty relative to Hard', () => {
    const base = review([3, 3, 3]);
    expect(schedule(base, 4, base.due, R).difficulty).toBeLessThan(schedule(base, 2, base.due, R).difficulty);
  });

  it('a higher desired retention means shorter intervals', () => {
    const interval = (retention: number) => {
      const s = review([3, 3, 3, 3], retention);
      return s.scheduled_days;
    };
    expect(interval(0.95)).toBeLessThan(interval(0.9));
    expect(interval(0.9)).toBeLessThan(interval(0.8));
  });

  it('is deterministic and does not mutate its input', () => {
    const base = review([3, 3, 3]);
    const copy = { ...base };
    const a = schedule(base, 3, base.due, R);
    const b = schedule(base, 3, base.due, R);
    expect(a).toEqual(b);
    expect(base).toEqual(copy);
  });

  it('produces plain JSON-safe state', () => {
    const s = review([3, 3, 3]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    for (const v of Object.values(s)) expect(typeof v).toBe('number');
  });

  it('a late review of a remembered card earns a longer interval than an on-time one', () => {
    const base = review([3, 3, 3, 3]);
    const onTime = schedule(base, 3, base.due, R);
    const late = schedule(base, 3, base.due + 30 * DAY, R);
    expect(late.stability).toBeGreaterThan(onTime.stability);
  });
});

describe('formatInterval', () => {
  it('picks a readable unit', () => {
    expect(formatInterval(20_000)).toBe('<1m');
    expect(formatInterval(10 * MIN)).toBe('10m');
    expect(formatInterval(3 * 60 * MIN)).toBe('3h');
    expect(formatInterval(4 * DAY)).toBe('4d');
    expect(formatInterval(45 * DAY)).toBe('1.5mo');
    expect(formatInterval(60 * DAY)).toBe('2mo');
    expect(formatInterval(438 * DAY)).toBe('1.2y');
  });
});

describe('day boundaries', () => {
  it('are local midnights around the given time', () => {
    expect(new Date(startOfDay(NOON)).getHours()).toBe(0);
    expect(startOfDay(NOON)).toBeLessThanOrEqual(NOON);
    expect(startOfNextDay(NOON)).toBeGreaterThan(NOON);
    expect(startOfNextDay(NOON) - startOfDay(NOON)).toBe(DAY);
    expect(startOfDay(startOfDay(NOON))).toBe(startOfDay(NOON));
    expect(startOfNextDay(startOfDay(NOON))).toBe(startOfDay(NOON) + DAY);
  });
});

describe('buildQueue', () => {
  const state = (over: Partial<CardState>): CardState => ({
    due: NOON, stability: 5, difficulty: 5, elapsed_days: 0, scheduled_days: 5, learning_steps: 0,
    reps: 3, lapses: 0, state: REVIEW, last_review: NOON - 5 * DAY, ...over,
  });
  const cards = ['n1', 'r-late', 'l-soon', 'n2', 'r-early', 'r-tomorrow', 'l-now', 'n3', 'r-tonight'].map(card);
  const states = new Map<string, CardState>([
    ['r-late', state({ due: NOON - DAY })],
    ['r-early', state({ due: NOON - 3 * DAY })],
    ['r-tomorrow', state({ due: startOfNextDay(NOON) })],
    ['r-tonight', state({ due: startOfNextDay(NOON) - 1 })],
    ['l-soon', state({ state: LEARNING, due: NOON + 8 * MIN })],
    ['l-now', state({ state: RELEARNING, due: NOON - MIN })],
  ]);

  it('orders learning cards, then due reviews oldest first, then new cards in note order', () => {
    expect(buildQueue(cards, states, NOON, 10).map((q) => q.id)).toEqual([
      'l-now', 'l-soon', 'r-early', 'r-late', 'r-tonight', 'n1', 'n2', 'n3',
    ]);
  });

  it('includes everything due before midnight and nothing after', () => {
    const ids = buildQueue(cards, states, NOON, 0).map((q) => q.id);
    expect(ids).toContain('r-tonight');
    expect(ids).not.toContain('r-tomorrow');
  });

  it('caps new cards at the allowance', () => {
    expect(buildQueue(cards, states, NOON, 2).filter((q) => q.due === 0).map((q) => q.id)).toEqual(['n1', 'n2']);
    expect(buildQueue(cards, states, NOON, 0).some((q) => q.id.startsWith('n'))).toBe(false);
    expect(buildQueue(cards, states, NOON, -3).some((q) => q.id.startsWith('n'))).toBe(false);
  });

  it('flags only cards in a learning step as learning', () => {
    const q = buildQueue(cards, states, NOON, 10);
    expect(q.filter((i) => i.learning).map((i) => i.id)).toEqual(['l-now', 'l-soon']);
  });

  it('treats a stored state of "new" like no state', () => {
    const q = buildQueue([card('x')], new Map([['x', state({ state: NEW })]]), NOON, 1);
    expect(q).toEqual([{ id: 'x', due: 0, learning: false }]);
  });

  it('ignores progress that belongs to no current card', () => {
    expect(buildQueue([], states, NOON, 10)).toEqual([]);
  });
});

describe('newSeenToday', () => {
  it('counts first-time reviews since local midnight', () => {
    const log = (t: number, state: number): ReviewLog => ({ id: 'x', t, rating: 3, state });
    const logs = [log(NOON - DAY, NEW), log(startOfDay(NOON), NEW), log(NOON - MIN, NEW), log(NOON - MIN, REVIEW), log(NOON, LEARNING)];
    expect(newSeenToday(logs, NOON)).toBe(2);
  });
});

describe('pickNext', () => {
  const item = (id: string, due: number, learning = false): QueueItem => ({ id, due, learning });

  it('returns undefined for an empty queue', () => {
    expect(pickNext([], NOON)).toBeUndefined();
  });

  it('shows a learning card as soon as it is due, ahead of waiting cards', () => {
    const q = [item('review', NOON - DAY), item('learn', NOON - 1, true)];
    expect(pickNext(q, NOON)!.id).toBe('learn');
  });

  it('shows waiting cards while learning cards are not due yet', () => {
    const q = [item('learn', NOON + 5 * MIN, true), item('review', NOON - DAY), item('new', 0)];
    expect(pickNext(q, NOON)!.id).toBe('review');
  });

  it('shows the soonest learning card early when nothing else is left', () => {
    const q = [item('later', NOON + 9 * MIN, true), item('sooner', NOON + 2 * MIN, true)];
    expect(pickNext(q, NOON)!.id).toBe('sooner');
  });

  it('among due learning cards, shows the one due longest', () => {
    const q = [item('b', NOON - MIN, true), item('a', NOON - 5 * MIN, true)];
    expect(pickNext(q, NOON)!.id).toBe('a');
  });
});

describe('afterAnswer', () => {
  const queue: QueueItem[] = [
    { id: 'a', due: 0, learning: false },
    { id: 'b', due: 0, learning: false },
  ];

  it('brings a card back later in the session when it is due again today', () => {
    const next = schedule(undefined, 1, NOON, R);
    expect(afterAnswer(queue, 'a', next, NOON)).toEqual([
      { id: 'b', due: 0, learning: false },
      { id: 'a', due: next.due, learning: true },
    ]);
  });

  it('drops a card that is next due on a later day', () => {
    const next = schedule(undefined, 4, NOON, R);
    expect(afterAnswer(queue, 'a', next, NOON)).toEqual([{ id: 'b', due: 0, learning: false }]);
  });

  it('does not change the queue it was given', () => {
    const copy = structuredClone(queue);
    afterAnswer(queue, 'a', schedule(undefined, 1, NOON, R), NOON);
    expect(queue).toEqual(copy);
  });

  it('a whole session ends: every card leaves the queue for a later day', () => {
    const cards = ['a', 'b', 'c', 'd'].map(card);
    const states = new Map<string, CardState>();
    let q = buildQueue(cards, states, NOON, 10);
    let now = NOON;
    let answers = 0;
    for (let item = pickNext(q, now); item; item = pickNext(q, now)) {
      // Miss each card once, then get it right.
      const rating: Rating = states.has(item.id) ? 3 : 1;
      const next = schedule(states.get(item.id), rating, now, R);
      states.set(item.id, next);
      q = afterAnswer(q, item.id, next, now);
      now += 20_000;
      expect(++answers).toBeLessThan(40);
    }
    expect(states.size).toBe(4);
    for (const s of states.values()) expect(s.due).toBeGreaterThanOrEqual(startOfNextDay(NOON));
    expect(buildQueue(cards, states, now, 10)).toEqual([]);
  });
});

describe('syncQueue', () => {
  const cards = ['new', 'due', 'learn'].map(card);
  const dueState = { ...review([3, 3]), due: NOON - DAY };
  const states = new Map<string, CardState>([
    ['due', dueState],
    ['learn', schedule(undefined, 1, NOON - MIN, R)],
  ]);
  const queue = buildQueue(cards, states, NOON, 10);
  const all = () => true;

  it('leaves a queue alone when nothing changed', () => {
    expect(queue).toHaveLength(3);
    expect(syncQueue(queue, states, all, NOON)).toEqual(queue);
  });

  it('keeps a card this session answered Again, as afterAnswer queued it', () => {
    const next = schedule(undefined, 1, NOON, R);
    const after = afterAnswer(queue, 'new', next, NOON);
    expect(syncQueue(after, new Map(states).set('new', next), all, NOON)).toEqual(after);
  });

  it('drops cards another tab answered into a later day', () => {
    const elsewhere = new Map(states).set('new', schedule(undefined, 4, NOON, R)).set('due', schedule(dueState, 3, NOON, R));
    expect(syncQueue(queue, elsewhere, all, NOON).map((q) => q.id)).toEqual(['learn']);
  });

  it('moves a new card another tab answered Again into its learning step', () => {
    const again = schedule(undefined, 1, NOON, R);
    const synced = syncQueue(queue, new Map(states).set('new', again), all, NOON);
    expect(synced.find((q) => q.id === 'new')).toEqual({ id: 'new', due: again.due, learning: true });
  });

  it('drops cards that no longer exist', () => {
    expect(syncQueue(queue, states, (id) => id !== 'due', NOON).map((q) => q.id)).toEqual(['learn', 'new']);
  });
});
