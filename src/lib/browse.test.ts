import { describe, expect, it } from 'vitest';
import { cardStatus, findCards, plainLine, statusLabel } from './browse';
import type { Card } from './parser';
import { DAY, LEARNING, NEW, REVIEW, type CardState } from './scheduler';

const NOON = new Date(2026, 5, 15, 12).getTime();
const card = (id: string, front: string, extra: Partial<Card> = {}): Card => ({
  id, kind: 'basic', front, back: `answer ${id}`, deck: 'Vault/bio', tags: [], source: 'Vault/bio.md', line: 1, seq: 0, ...extra,
});
const state = (due: number, s = REVIEW): CardState => ({
  due, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: s,
});

describe('cardStatus', () => {
  it('puts suspended first, then new, due before midnight, or later', () => {
    expect(cardStatus(state(NOON - DAY), true, NOON)).toEqual({ kind: 'suspended' });
    expect(cardStatus(undefined, false, NOON)).toEqual({ kind: 'new' });
    expect(cardStatus(state(NOON, NEW), false, NOON)).toEqual({ kind: 'new' });
    expect(cardStatus(state(NOON + 6 * 3_600_000, LEARNING), false, NOON)).toEqual({ kind: 'due' }); // 18:00 today
    expect(cardStatus(state(NOON + 3 * DAY), false, NOON)).toEqual({ kind: 'later', due: NOON + 3 * DAY });
  });

  it('labels each status', () => {
    expect(statusLabel({ kind: 'later', due: NOON + 3 * DAY }, NOON)).toBe('Due in 3d');
    expect(statusLabel({ kind: 'due' }, NOON)).toBe('Due today');
    expect(statusLabel({ kind: 'new' }, NOON)).toBe('New');
    expect(statusLabel({ kind: 'suspended' }, NOON)).toBe('Suspended');
  });
});

describe('findCards', () => {
  const cards = [
    card('mito', 'What is the powerhouse of the cell?', { tags: ['exam'] }),
    card('ribo', 'What do ribosomes make?', { back: 'Proteins' }),
    card('rust', 'What does `Vec::new` return?', { deck: 'Code/Rust', source: 'Code/rust notes.md' }),
    card('hist', 'When did the Berlin Wall fall?', { deck: 'History' }),
  ];
  const states = new Map([['ribo', state(NOON - DAY)], ['rust', state(NOON + 5 * DAY)]]);
  const suspended = new Set(['hist']);
  const ids = (query: string, show: Parameters<typeof findCards>[5] = 'all') =>
    findCards(cards, states, suspended, NOON, query, show).map((c) => c.id);

  it('returns everything, in order, for an empty search', () => {
    expect(ids('')).toEqual(['mito', 'ribo', 'rust', 'hist']);
    expect(ids('   ')).toEqual(['mito', 'ribo', 'rust', 'hist']);
  });

  it('matches every word, ignoring case and extra spaces, anywhere in the card', () => {
    expect(ids('POWERHOUSE')).toEqual(['mito']);
    expect(ids('what   cell')).toEqual(['mito']);
    expect(ids('proteins')).toEqual(['ribo']); // the answer
    expect(ids('code/rust')).toEqual(['rust']); // the deck
    expect(ids('rust notes')).toEqual(['rust']); // the note path
    expect(ids('#exam')).toEqual(['mito']); // a tag
    expect(ids('vec::new')).toEqual(['rust']);
    expect(ids('powerhouse berlin')).toEqual([]);
  });

  it('filters by status', () => {
    expect(ids('', 'new')).toEqual(['mito']);
    expect(ids('', 'due')).toEqual(['ribo']);
    expect(ids('', 'suspended')).toEqual(['hist']);
    expect(ids('wall', 'suspended')).toEqual(['hist']);
    expect(ids('ribosomes', 'suspended')).toEqual([]);
  });
});

describe('plainLine', () => {
  it('drops code ticks, bold and cloze marks and joins lines', () => {
    expect(plainLine('Use `Q :: A`\nor **bold** and ==[…]==.')).toBe('Use Q :: A or bold and […].');
    expect(plainLine('The ==FSRS== algorithm')).toBe('The FSRS algorithm');
  });
  it('leaves comparisons and lone markers alone', () => {
    expect(plainLine('a == b and c ** d')).toBe('a == b and c ** d');
    expect(plainLine('a lone ` tick')).toBe('a lone ` tick');
  });
});
