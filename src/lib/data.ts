// The app's whole dataset, and its JSON backup format.
import type { Card } from './parser';
import type { CardState, ReviewLog } from './scheduler';

export interface Settings {
  /** Reviews per day you aim for. */
  dailyGoal: number;
  /** New cards introduced per day. */
  newPerDay: number;
  /** Target probability of recalling a card when it comes due (FSRS desired retention). */
  retention: number;
  /** Import headings as questions. */
  headings: boolean;
}

export const DEFAULT_SETTINGS: Settings = { dailyGoal: 20, newPerDay: 10, retention: 0.9, headings: false };

export interface AppData {
  cards: Card[];
  states: Map<string, CardState>;
  logs: ReviewLog[];
  settings: Settings;
}

export interface Backup {
  app: 'recallmd';
  version: 1;
  exportedAt: string;
  settings: Settings;
  cards: Card[];
  states: Record<string, CardState>;
  logs: ReviewLog[];
}

export function makeBackup(data: AppData, now: number): Backup {
  return {
    app: 'recallmd',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    settings: data.settings,
    cards: data.cards,
    states: Object.fromEntries(data.states),
    logs: data.logs,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Fills in defaults and forces every setting into its allowed range. */
export function cleanSettings(raw: unknown): Settings {
  const s = isObject(raw) ? raw : {};
  const int = (v: unknown, fallback: number, min: number, max: number) => (isNumber(v) ? clamp(Math.round(v), min, max) : fallback);
  return {
    dailyGoal: int(s.dailyGoal, DEFAULT_SETTINGS.dailyGoal, 1, 9999),
    newPerDay: int(s.newPerDay, DEFAULT_SETTINGS.newPerDay, 0, 9999),
    retention: isNumber(s.retention) ? clamp(s.retention, 0.7, 0.97) : DEFAULT_SETTINGS.retention,
    headings: s.headings === true,
  };
}

function isCard(v: unknown): v is Card {
  return (
    isObject(v) &&
    isString(v.id) && v.id.length > 0 &&
    (v.kind === 'basic' || v.kind === 'cloze' || v.kind === 'heading') &&
    isString(v.front) && isString(v.back) && isString(v.deck) && isString(v.source) &&
    isNumber(v.line) && isNumber(v.seq) &&
    Array.isArray(v.tags) && v.tags.every(isString)
  );
}

/** Largest time a JavaScript Date can hold. */
const MAX_TIME = 8.64e15;
const isTime = (v: unknown): v is number => isNumber(v) && v >= 0 && v <= MAX_TIME;
const isCount = (v: unknown): v is number => isNumber(v) && v >= 0;

// Ranges matter, not just types: FSRS throws on a negative stability and returns NaN for an absurd date.
function isState(v: unknown): v is CardState {
  return (
    isObject(v) &&
    isTime(v.due) && (v.last_review === undefined || isTime(v.last_review)) &&
    isCount(v.stability) && v.stability <= 36500 &&
    isCount(v.difficulty) && v.difficulty <= 10 &&
    isCount(v.elapsed_days) && isCount(v.scheduled_days) && isCount(v.learning_steps) &&
    isCount(v.reps) && isCount(v.lapses) &&
    isNumber(v.state) && [0, 1, 2, 3].includes(v.state) &&
    // Anything past "new" has been reviewed, so it has a memory state.
    (v.state === 0 || (v.stability > 0 && v.difficulty >= 1))
  );
}

function isLog(v: unknown): v is ReviewLog {
  return (
    isObject(v) && isString(v.id) && isTime(v.t) &&
    isNumber(v.rating) && [1, 2, 3, 4].includes(v.rating) &&
    isNumber(v.state) && [0, 1, 2, 3].includes(v.state)
  );
}

/** Parses and validates a backup file. Throws an Error that says what is wrong. */
export function parseBackup(json: string): AppData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isObject(raw) || raw.app !== 'recallmd') throw new Error('This is not a recallmd backup.');
  if (raw.version !== 1) throw new Error(`Backup version ${String(raw.version)} is not supported by this version of recallmd.`);
  if (!Array.isArray(raw.cards) || !raw.cards.every(isCard)) throw new Error('The backup has damaged cards.');
  if (!isObject(raw.states) || !Object.values(raw.states).every(isState)) throw new Error('The backup has damaged scheduling data.');
  if (!Array.isArray(raw.logs) || !raw.logs.every(isLog)) throw new Error('The backup has a damaged review history.');
  const ids = new Set(raw.cards.map((c) => c.id));
  if (ids.size !== raw.cards.length) throw new Error('The backup has duplicate cards.');
  return {
    settings: cleanSettings(raw.settings),
    cards: raw.cards,
    states: new Map(Object.entries(raw.states as Record<string, CardState>)),
    logs: raw.logs,
  };
}
