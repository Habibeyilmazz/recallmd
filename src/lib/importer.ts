// Works out what an import changes, before anything is written.
import { normalize, parseMarkdown, type Card, type ParseOptions } from './parser';

export interface NoteFile {
  path: string;
  text: string;
}

export interface ImportPlan {
  /** Cards to write (new and existing). */
  upsert: Card[];
  /** Cards that disappeared from a re-imported note. */
  remove: string[];
  /** Review progress to carry from a removed card to its reworded replacement: [from, to]. */
  moves: [string, string][];
  files: number;
  added: number;
  changed: number;
  unchanged: number;
  warnings: string[];
}

/** Dice coefficient over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      shared++;
    }
  }
  return (2 * shared) / (x.length + y.length - 2);
}

const clozeAnswer = (c: Card) => /==(.+?)==/s.exec(c.back)?.[1] ?? '';

/**
 * How likely `next` is `old` with its question reworded: 0 means "a different card".
 * The answer (for a cloze, the hidden text) has to be unchanged; a new question with a
 * new answer is a new card however similar the wording, e.g. the same question template
 * asked about something else.
 */
export function rewordScore(old: Card, next: Card): number {
  if (answerKey(old) !== answerKey(next)) return 0;
  const score = similarity(old.front, next.front);
  return score >= 0.6 ? score : 0;
}

/** Cards can only be the same card reworded if this matches. */
const answerKey = (c: Card) => `${c.kind}\n${normalize(c.kind === 'cloze' ? clozeAnswer(c) : c.back)}`;

/** Most question pairs one import compares; a note rewritten wholesale would otherwise freeze the tab. */
const MAX_COMPARISONS = 200_000;

export function planImport(
  existing: Card[],
  hasProgress: (id: string) => boolean,
  files: NoteFile[],
  options: ParseOptions = {},
): ImportPlan {
  const warnings: string[] = [];
  const incoming = new Map<string, Card>();
  for (const file of files) {
    const parsed = parseMarkdown(file.text, file.path, options);
    warnings.push(...parsed.warnings);
    for (const card of parsed.cards) {
      const first = incoming.get(card.id);
      if (first) warnings.push(`${card.source}:${card.line}: same question as ${first.source}:${first.line}, skipped`);
      else incoming.set(card.id, card);
    }
  }

  const byId = new Map(existing.map((c) => [c.id, c]));
  const sources = new Set(files.map((f) => f.path));
  const gone = existing.filter((c) => sources.has(c.source) && !incoming.has(c.id));

  let added = 0;
  let changed = 0;
  let unchanged = 0;
  const fresh: Card[] = [];
  for (const card of incoming.values()) {
    const old = byId.get(card.id);
    if (!old) {
      added++;
      fresh.push(card);
    } else if (old.front === card.front && old.back === card.back && old.deck === card.deck && old.tags.join() === card.tags.join()) {
      unchanged++;
    } else {
      changed++;
    }
  }

  // Reworded questions get a new id; hand the old card's progress to the closest new card.
  const pairs: { from: string; to: string; score: number }[] = [];
  const byAnswer = new Map<string, Card[]>();
  for (const next of fresh) {
    if (hasProgress(next.id)) continue;
    const key = answerKey(next);
    const list = byAnswer.get(key);
    if (list) list.push(next);
    else byAnswer.set(key, [next]);
  }
  let budget = MAX_COMPARISONS;
  let skipped = 0;
  for (const old of gone) {
    if (!hasProgress(old.id)) continue;
    const candidates = byAnswer.get(answerKey(old)) ?? [];
    if (candidates.length > budget) {
      skipped++;
      continue;
    }
    budget -= candidates.length;
    for (const next of candidates) {
      const score = rewordScore(old, next);
      if (score) pairs.push({ from: old.id, to: next.id, score });
    }
  }
  if (skipped) warnings.push(`${skipped} reviewed cards were rewritten too much to match with their new wording; their progress is kept but not moved to the new cards.`);
  pairs.sort((a, b) => b.score - a.score);
  const moves: [string, string][] = [];
  const used = new Set<string>();
  for (const p of pairs) {
    if (used.has(p.from) || used.has(p.to)) continue;
    used.add(p.from).add(p.to);
    moves.push([p.from, p.to]);
  }

  return {
    upsert: [...incoming.values()],
    remove: gone.map((c) => c.id),
    moves,
    files: files.length,
    added,
    changed,
    unchanged,
    warnings,
  };
}
