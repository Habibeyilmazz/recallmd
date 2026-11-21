// FSRS scheduling (via ts-fsrs) and the review queue. Times are epoch milliseconds.
import { createEmptyCard, fsrs, GenSeedStrategyWithCardId, generatorParameters, StrategyMode, type FSRS, type Grade } from 'ts-fsrs';
import type { Card } from './parser';

export const NEW = 0;
export const LEARNING = 1;
export const REVIEW = 2;
export const RELEARNING = 3;

/** 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type Rating = 1 | 2 | 3 | 4;

/** A ts-fsrs card with dates as numbers, so it stores and exports as plain JSON. */
export interface CardState {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: number;
}

export interface ReviewLog {
  /** Card id. */
  id: string;
  /** When the review happened. */
  t: number;
  rating: Rating;
  /** The card's state before this review. */
  state: number;
}

export interface QueueItem {
  id: string;
  due: number;
  /** In a short (minutes) learning step: shown again in this session once due. */
  learning: boolean;
}

const DAY = 86_400_000;

/** Local midnight at or before `t`. */
export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight after `t`. Calendar-based, so it is right across DST changes. */
export function startOfNextDay(t: number): number {
  const d = new Date(t);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

const engines = new Map<number, FSRS>();
function engine(retention: number): FSRS {
  let f = engines.get(retention);
  if (!f) {
    // Fuzz is seeded by card id and review count, not the clock (the ts-fsrs default), so the
    // interval a rating button shows is the one the card gets when it is pressed seconds later.
    f = fsrs(generatorParameters({ request_retention: retention, enable_fuzz: true })).useStrategy(
      StrategyMode.SEED,
      GenSeedStrategyWithCardId('id'),
    );
    engines.set(retention, f);
  }
  return f;
}

/** The card's state after answering with `rating` at `now`. `state` is undefined for a new card. `id` seeds the fuzz. */
export function schedule(state: CardState | undefined, rating: Rating, now: number, retention: number, id = ''): CardState {
  const { card } = engine(retention).next(Object.assign({}, state ?? createEmptyCard(now), { id }), now, rating as Grade);
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review?.getTime(),
  };
}

/** Milliseconds until the card would be due again, for each rating. */
export function previewIntervals(state: CardState | undefined, now: number, retention: number, id = ''): Record<Rating, number> {
  const ms = (r: Rating) => schedule(state, r, now, retention, id).due - now;
  return { 1: ms(1), 2: ms(2), 3: ms(3), 4: ms(4) };
}

/** "<1m", "10m", "3h", "4d", "2.5mo", "1.2y". */
export function formatInterval(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  const days = minutes / (60 * 24);
  if (days < 30) return `${Math.round(days)}d`;
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '');
  return days < 365 ? `${trim(days / 30)}mo` : `${trim(days / 365)}y`;
}

/** How many new cards were first seen today. */
export function newSeenToday(logs: ReviewLog[], now: number): number {
  const from = startOfDay(now);
  return logs.filter((l) => l.t >= from && l.state === NEW).length;
}

/**
 * Today's queue for `cards`: cards in a learning step, then reviews due before
 * midnight, then new cards up to what is left of the daily allowance.
 */
export function buildQueue(
  cards: Card[],
  states: ReadonlyMap<string, CardState>,
  now: number,
  newAllowance: number,
): QueueItem[] {
  const midnight = startOfNextDay(now);
  const learning: QueueItem[] = [];
  const reviews: QueueItem[] = [];
  const fresh: QueueItem[] = [];
  for (const card of cards) {
    const s = states.get(card.id);
    if (!s || s.state === NEW) {
      if (fresh.length < newAllowance) fresh.push({ id: card.id, due: 0, learning: false });
    } else if (s.due < midnight) {
      const inStep = s.state !== REVIEW;
      (inStep ? learning : reviews).push({ id: card.id, due: s.due, learning: inStep });
    }
  }
  const byDue = (a: QueueItem, b: QueueItem) => a.due - b.due;
  return [...learning.sort(byDue), ...reviews.sort(byDue), ...fresh];
}

/**
 * The card to show now: a learning card that has come due, else the next
 * waiting card, else the learning card due soonest (shown early rather than
 * making you wait).
 */
export function pickNext(queue: QueueItem[], now: number): QueueItem | undefined {
  const soonest = queue.filter((q) => q.learning).sort((a, b) => a.due - b.due)[0];
  if (soonest && soonest.due <= now) return soonest;
  return queue.find((q) => !q.learning) ?? soonest;
}

/** The queue after `id` was answered: it leaves, and comes back if it is due again today. */
export function afterAnswer(queue: QueueItem[], id: string, next: CardState, now: number): QueueItem[] {
  const rest = queue.filter((q) => q.id !== id);
  return next.due < startOfNextDay(now) ? [...rest, { id, due: next.due, learning: true }] : rest;
}

/**
 * A session's queue brought up to date with the stored states, which another tab may have
 * changed since the session started: cards answered into a later day or removed elsewhere
 * leave, and cards still due today take their new due time.
 */
export function syncQueue(
  queue: QueueItem[],
  states: ReadonlyMap<string, CardState>,
  exists: (id: string) => boolean,
  now: number,
): QueueItem[] {
  const midnight = startOfNextDay(now);
  return queue.flatMap((q) => {
    if (!exists(q.id)) return [];
    const s = states.get(q.id);
    if (!s || s.state === NEW) return [q];
    if (s.due >= midnight) return [];
    return [{ id: q.id, due: s.due, learning: q.learning || s.state !== REVIEW }];
  });
}

export { DAY };
