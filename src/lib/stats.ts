// Numbers behind the Today panel and the Stats page. Days are local calendar days.
import type { Card } from './parser';
import { DAY, LEARNING, NEW, RELEARNING, REVIEW, startOfDay, startOfNextDay, type CardState, type ReviewLog } from './scheduler';

/** Local calendar day as a sortable number, e.g. 20261121. */
export function dayKey(t: number): number {
  const d = new Date(t);
  return d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** `n` calendar days before (negative: after) the day containing `t`, at local midnight. */
export function shiftDay(t: number, n: number): number {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() - n);
  return d.getTime();
}

export function reviewsToday(logs: ReviewLog[], now: number): number {
  const from = startOfDay(now);
  return logs.filter((l) => l.t >= from).length;
}

/**
 * Consecutive days with at least one review. A streak is still alive if you
 * reviewed yesterday but not yet today.
 */
export function streak(logs: ReviewLog[], now: number): { current: number; longest: number } {
  const days = new Set(logs.map((l) => dayKey(l.t)));
  let current = 0;
  for (let n = days.has(dayKey(now)) ? 0 : 1; days.has(dayKey(shiftDay(now, n))); n++) current++;

  let longest = 0;
  let run = 0;
  let previous: number | undefined;
  for (const t of [...new Set(logs.map((l) => startOfDay(l.t)))].sort((a, b) => a - b)) {
    run = previous !== undefined && dayKey(shiftDay(t, 1)) === dayKey(previous) ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = t;
  }
  return { current, longest };
}

/** Review counts for the last `days` days, oldest first, today last. */
export function reviewsPerDay(logs: ReviewLog[], now: number, days: number): number[] {
  const index = new Map<number, number>();
  for (let n = 0; n < days; n++) index.set(dayKey(shiftDay(now, n)), days - 1 - n);
  const out = new Array<number>(days).fill(0);
  for (const l of logs) {
    const i = index.get(dayKey(l.t));
    if (i !== undefined) out[i]!++;
  }
  return out;
}

/**
 * True retention: of the reviews of cards that had already graduated to
 * "review", the share answered Hard, Good or Easy. `rate` is null with no data.
 */
export function retention(logs: ReviewLog[], now: number, days: number): { reviews: number; recalled: number; rate: number | null } {
  const from = shiftDay(now, days - 1);
  const mature = logs.filter((l) => l.t >= from && l.t <= now && l.state === REVIEW);
  const recalled = mature.filter((l) => l.rating > 1).length;
  return { reviews: mature.length, recalled, rate: mature.length ? recalled / mature.length : null };
}

/** Cards coming due on each of the next `days` days. Index 0 is today and includes everything overdue. */
export function forecast(cards: Card[], states: ReadonlyMap<string, CardState>, now: number, days: number): number[] {
  const out = new Array<number>(days).fill(0);
  const today = startOfDay(now);
  for (const card of cards) {
    const s = states.get(card.id);
    if (!s || s.state === NEW) continue;
    // Round, not floor: local days are 23 or 25 hours long across a DST change.
    const i = Math.max(0, Math.round((startOfDay(s.due) - today) / DAY));
    if (i < days) out[i]!++;
  }
  return out;
}

export interface Counts {
  total: number;
  new: number;
  learning: number;
  review: number;
  /** Learning or review cards due before midnight. */
  due: number;
}

export function countCards(cards: Card[], states: ReadonlyMap<string, CardState>, now: number): Counts {
  const midnight = startOfNextDay(now);
  const c: Counts = { total: cards.length, new: 0, learning: 0, review: 0, due: 0 };
  for (const card of cards) {
    const s = states.get(card.id);
    if (!s || s.state === NEW) {
      c.new++;
      continue;
    }
    if (s.state === LEARNING || s.state === RELEARNING) c.learning++;
    else c.review++;
    if (s.due < midnight) c.due++;
  }
  return c;
}

export interface DeckRow {
  /** Full deck path, e.g. "Vault/bio/cells". */
  path: string;
  /** Last path segment. */
  name: string;
  depth: number;
  /** Counts for this deck including everything below it. */
  counts: Counts;
}

export const inDeck = (card: Card, deck: string) => card.deck === deck || card.deck.startsWith(`${deck}/`);

/** Every deck and parent folder as a flat list in tree order (parents directly above their children). */
export function deckRows(cards: Card[], states: ReadonlyMap<string, CardState>, now: number): DeckRow[] {
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const parts = card.deck.split('/');
    for (let n = 1; n <= parts.length; n++) {
      const path = parts.slice(0, n).join('/');
      const list = groups.get(path);
      if (list) list.push(card);
      else groups.set(path, [card]);
    }
  }
  const bySegments = (a: string[], b: string[]): number => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const order = a[i]!.localeCompare(b[i]!);
      if (order) return order;
    }
    return a.length - b.length;
  };
  return [...groups]
    .map(([path, list]) => ({ path, parts: path.split('/'), counts: countCards(list, states, now) }))
    .sort((a, b) => bySegments(a.parts, b.parts))
    .map(({ path, parts, counts }) => ({ path, name: parts[parts.length - 1]!, depth: parts.length - 1, counts }));
}
