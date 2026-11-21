import { describe, expect, it } from 'vitest';
import { planImport, rewordScore, similarity } from './importer';
import { parseMarkdown, type Card } from './parser';

const cardsOf = (text: string, path = 'a.md') => parseMarkdown(text, path).cards;
const none = () => false;

describe('similarity', () => {
  it('is 1 for equal text (ignoring case and spacing) and 0 for unrelated text', () => {
    expect(similarity('What is  ATP?', 'what is atp?')).toBe(1);
    expect(similarity('abcd', 'wxyz')).toBe(0);
    expect(similarity('a', 'a')).toBe(1);
    expect(similarity('a', 'b')).toBe(0);
  });

  it('is high for a typo fix and low for a different question', () => {
    expect(similarity('What is the capitol of France?', 'What is the capital of France?')).toBeGreaterThan(0.85);
    expect(similarity('When did WW2 end?', 'When was the UN founded?')).toBeLessThan(0.5);
  });
});

describe('rewordScore', () => {
  const basic = (front: string, back: string) => cardsOf(`${front} :: ${back}`)[0]!;
  const cloze = (text: string) => cardsOf(text)[0]!;

  it('accepts a lightly reworded question', () => {
    expect(rewordScore(basic('What is the capitol of France?', 'Paris'), basic('What is the capital of France?', 'Paris'))).toBeGreaterThan(0);
  });

  it('accepts a heavier rewording only when the answer is unchanged', () => {
    const old = basic('Capital city of France?', 'Paris');
    expect(rewordScore(old, basic('What is the capital of France?', 'Paris'))).toBeGreaterThan(0);
    expect(rewordScore(old, basic('What is the capital of France?', 'Lyon'))).toBe(0);
  });

  it('rejects different questions that share an answer', () => {
    expect(rewordScore(basic('When did WW2 end?', '1945'), basic('When was the UN founded?', '1945'))).toBe(0);
  });

  it('rejects a different kind, and a cloze hiding something else', () => {
    expect(rewordScore(basic('The sky is blue', 'x'), cloze('The sky is ==blue=='))).toBe(0);
    expect(rewordScore(cloze('The ==sky== is blue today'), cloze('The sky is ==blue== today'))).toBe(0);
    expect(rewordScore(cloze('The sky is ==blue=='), cloze('The sky is usually ==blue=='))).toBeGreaterThan(0);
  });
});

describe('planImport', () => {
  it('adds everything on a first import', () => {
    const plan = planImport([], none, [{ path: 'a.md', text: 'q1 :: a1\nq2 :: a2' }]);
    expect(plan).toMatchObject({ files: 1, added: 2, changed: 0, unchanged: 0, remove: [], moves: [], warnings: [] });
    expect(plan.upsert.map((c) => c.front)).toEqual(['q1', 'q2']);
  });

  it('reports nothing to do when a note is imported again unchanged', () => {
    const existing = cardsOf('q1 :: a1\nq2 :: a2');
    const plan = planImport(existing, none, [{ path: 'a.md', text: 'q1 :: a1\nq2 :: a2' }]);
    expect(plan).toMatchObject({ added: 0, changed: 0, unchanged: 2, remove: [] });
  });

  it('keeps the card (same id) when only the answer changes', () => {
    const existing = cardsOf('q1 :: a1');
    const plan = planImport(existing, () => true, [{ path: 'a.md', text: 'q1 :: a much better answer' }]);
    expect(plan).toMatchObject({ added: 0, changed: 1, remove: [], moves: [] });
    expect(plan.upsert[0]).toMatchObject({ id: existing[0]!.id, back: 'a much better answer' });
  });

  it('removes cards deleted from a re-imported note, and only from that note', () => {
    const existing = [...cardsOf('q1 :: a1\nq2 :: a2', 'a.md'), ...cardsOf('q3 :: a3', 'b.md')];
    const plan = planImport(existing, none, [{ path: 'a.md', text: 'q1 :: a1' }]);
    expect(plan.remove).toEqual([existing[1]!.id]);
  });

  it('carries progress over to a reworded question', () => {
    const existing = cardsOf('What is the capitol of France? :: Paris\nother :: x');
    const studied = new Set([existing[0]!.id]);
    const plan = planImport(existing, (id) => studied.has(id), [
      { path: 'a.md', text: 'What is the capital of France? :: Paris\nother :: x\nbrand new :: y' },
    ]);
    const reworded = plan.upsert.find((c) => c.front.includes('capital'))!;
    expect(plan.moves).toEqual([[existing[0]!.id, reworded.id]]);
    expect(plan.remove).toEqual([existing[0]!.id]);
    expect(plan.added).toBe(2);
  });

  it('does not carry over progress the old card never had', () => {
    const existing = cardsOf('What is the capitol of France? :: Paris');
    const plan = planImport(existing, none, [{ path: 'a.md', text: 'What is the capital of France? :: Paris' }]);
    expect(plan.moves).toEqual([]);
  });

  it('matches each old card to at most one new card, best match first', () => {
    const existing = cardsOf('Define osmosis in one sentence :: x\nDefine osmosis in two sentences :: y');
    const studied = new Set(existing.map((c) => c.id));
    const plan = planImport(existing, (id) => studied.has(id), [
      { path: 'a.md', text: 'Define osmosis in 1 sentence :: x\nDefine osmosis in 2 sentences :: y' },
    ]);
    const idOf = (front: string) => plan.upsert.find((c) => c.front === front)!.id;
    expect(new Map(plan.moves)).toEqual(
      new Map([
        [existing[0]!.id, idOf('Define osmosis in 1 sentence')],
        [existing[1]!.id, idOf('Define osmosis in 2 sentences')],
      ]),
    );
  });

  it('moves a card to its new note when a note is renamed, without duplicating it', () => {
    const existing = cardsOf('q1 :: a1', 'old/name.md');
    const plan = planImport(existing, () => true, [{ path: 'new/name.md', text: 'q1 :: a1' }]);
    expect(plan).toMatchObject({ added: 0, changed: 1, remove: [], moves: [] });
    expect(plan.upsert[0]).toMatchObject({ id: existing[0]!.id, deck: 'new/name', source: 'new/name.md' });
  });

  it('skips a question repeated in another note of the same import', () => {
    const plan = planImport([], none, [
      { path: 'a.md', text: 'q :: a' },
      { path: 'b.md', text: 'q :: b' },
    ]);
    expect(plan.upsert).toHaveLength(1);
    expect(plan.warnings).toEqual(['b.md:1: same question as a.md:1, skipped']);
  });

  it('passes parser options through', () => {
    const plan = planImport([], none, [{ path: 'a.md', text: '# Topic\nbody' }], { headings: true });
    expect(plan.upsert.map((c): Card['kind'] => c.kind)).toEqual(['heading']);
  });
});
