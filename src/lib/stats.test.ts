import { describe, expect, it } from 'vitest';
import type { Card } from './parser';
import { DAY, LEARNING, NEW, RELEARNING, REVIEW, startOfDay, type CardState, type Rating, type ReviewLog } from './scheduler';
import { countCards, dayKey, deckRows, forecast, inDeck, retention, reviewsPerDay, reviewsToday, shiftDay, streak } from './stats';

const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime();
const daysAgo = (n: number, hour = 12) => new Date(2026, 5, 15 - n, hour).getTime();
const log = (t: number, rating: Rating = 3, state = REVIEW): ReviewLog => ({ id: 'c', t, rating, state });
const card = (id: string): Card => ({ id, kind: 'basic', front: id, back: '', deck: 'd', tags: [], source: 'd.md', line: 1, seq: 0 });
const state = (due: number, s = REVIEW): CardState => ({
  due, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: s,
});

describe('day helpers', () => {
  it('dayKey is the local calendar date', () => {
    expect(dayKey(NOON)).toBe(20260615);
    expect(dayKey(new Date(2026, 0, 1, 0, 0, 0).getTime())).toBe(20260101);
    expect(dayKey(new Date(2025, 11, 31, 23, 59, 59).getTime())).toBe(20251231);
  });

  it('shiftDay steps whole calendar days, across month ends', () => {
    expect(dayKey(shiftDay(NOON, 15))).toBe(20260531);
    expect(dayKey(shiftDay(NOON, -16))).toBe(20260701);
    expect(shiftDay(NOON, 0)).toBe(startOfDay(NOON));
  });
});

describe('reviewsToday', () => {
  it('counts reviews since local midnight', () => {
    expect(reviewsToday([log(daysAgo(1, 23)), log(daysAgo(0, 0)), log(daysAgo(0, 11))], NOON)).toBe(2);
  });
});

describe('streak', () => {
  it('is zero with no reviews', () => {
    expect(streak([], NOON)).toEqual({ current: 0, longest: 0 });
  });

  it('counts consecutive days ending today', () => {
    expect(streak([log(daysAgo(0)), log(daysAgo(1)), log(daysAgo(1, 9)), log(daysAgo(2))], NOON).current).toBe(3);
  });

  it('stays alive when today has no review yet but yesterday does', () => {
    expect(streak([log(daysAgo(1)), log(daysAgo(2))], NOON).current).toBe(2);
  });

  it('is broken by a missed day', () => {
    expect(streak([log(daysAgo(2)), log(daysAgo(3))], NOON)).toEqual({ current: 0, longest: 2 });
    expect(streak([log(daysAgo(0)), log(daysAgo(2)), log(daysAgo(3))], NOON).current).toBe(1);
  });

  it('remembers the longest run, in any log order', () => {
    const logs = [9, 0, 7, 8, 6, 3, 1].map((n) => log(daysAgo(n)));
    expect(streak(logs, NOON)).toEqual({ current: 2, longest: 4 });
  });

  it('counts a late-night and an early-morning review as two days', () => {
    expect(streak([log(daysAgo(1, 23)), log(daysAgo(0, 1))], NOON).current).toBe(2);
  });
});

describe('reviewsPerDay', () => {
  it('buckets by day, oldest first, today last', () => {
    const logs = [log(daysAgo(0)), log(daysAgo(0, 1)), log(daysAgo(2)), log(daysAgo(6)), log(daysAgo(7))];
    expect(reviewsPerDay(logs, NOON, 7)).toEqual([1, 0, 0, 0, 1, 0, 2]);
  });
});

describe('retention', () => {
  it('is null when no graduated card was reviewed', () => {
    expect(retention([log(NOON, 1, NEW), log(NOON, 3, LEARNING), log(NOON, 3, RELEARNING)], NOON, 30)).toEqual({
      reviews: 0, recalled: 0, rate: null,
    });
  });

  it('counts Hard, Good and Easy as recalled and Again as forgotten', () => {
    const logs = [log(NOON, 1), log(NOON, 2), log(NOON, 3), log(NOON, 4)];
    expect(retention(logs, NOON, 30)).toEqual({ reviews: 4, recalled: 3, rate: 0.75 });
  });

  it('only looks at the window', () => {
    const logs = [log(daysAgo(29, 1), 1), log(daysAgo(30, 23), 1), log(daysAgo(0), 3)];
    expect(retention(logs, NOON, 30)).toEqual({ reviews: 2, recalled: 1, rate: 0.5 });
  });
});

describe('forecast', () => {
  it('puts overdue cards on today and skips new cards and far-off ones', () => {
    const cards = ['overdue', 'today', 'tomorrow', 'tomorrow2', 'day3', 'far', 'new', 'stored-new'].map(card);
    const states = new Map([
      ['overdue', state(NOON - 9 * DAY)],
      ['today', state(NOON + 60_000, LEARNING)],
      ['tomorrow', state(daysAgo(-1, 0))],
      ['tomorrow2', state(daysAgo(-1, 23))],
      ['day3', state(daysAgo(-3))],
      ['far', state(daysAgo(-4))],
      ['stored-new', state(NOON, NEW)],
      ['deleted-card', state(NOON)],
    ]);
    expect(forecast(cards, states, NOON, 4)).toEqual([2, 2, 0, 1]);
  });
});

describe('countCards', () => {
  it('splits cards by state and counts what is due before midnight', () => {
    const cards = ['n', 'l', 'rl', 'r-due', 'r-later'].map(card);
    const states = new Map([
      ['l', state(NOON + 60_000, LEARNING)],
      ['rl', state(NOON + DAY, RELEARNING)],
      ['r-due', state(NOON - DAY)],
      ['r-later', state(NOON + 2 * DAY)],
    ]);
    expect(countCards(cards, states, NOON)).toEqual({ total: 5, new: 1, learning: 2, review: 2, due: 2 });
  });
});

describe('decks', () => {
  const inDeckCard = (id: string, deck: string): Card => ({ ...card(id), deck });

  it('inDeck matches a deck and everything below it, not look-alike names', () => {
    expect(inDeck(inDeckCard('a', 'bio'), 'bio')).toBe(true);
    expect(inDeck(inDeckCard('a', 'bio/cells'), 'bio')).toBe(true);
    expect(inDeck(inDeckCard('a', 'biology'), 'bio')).toBe(false);
    expect(inDeck(inDeckCard('a', 'bio'), 'bio/cells')).toBe(false);
  });

  it('lists folders above their decks with rolled-up counts', () => {
    const cards = [
      inDeckCard('1', 'bio/cells'), inDeckCard('2', 'bio/cells'), inDeckCard('3', 'bio/plants'),
      inDeckCard('4', 'bio notes'), inDeckCard('5', 'Zoology'),
    ];
    const rows = deckRows(cards, new Map([['1', state(NOON - DAY)]]), NOON);
    expect(rows.map((r) => [r.path, r.name, r.depth, r.counts.total])).toEqual([
      ['bio', 'bio', 0, 3],
      ['bio/cells', 'cells', 1, 2],
      ['bio/plants', 'plants', 1, 1],
      ['bio notes', 'bio notes', 0, 1],
      ['Zoology', 'Zoology', 0, 1],
    ]);
    expect(rows[0]!.counts).toEqual({ total: 3, new: 2, learning: 0, review: 1, due: 1 });
  });
});
