import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sample from '../sample/learn-recallmd.md?raw';
import { byNote, cardId, hash, normalize, parseMarkdown } from './parser';

const parse = (text: string, options = {}) => parseMarkdown(text, 'notes/test.md', options);
const pairs = (text: string, options = {}) => parse(text, options).cards.map((c) => [c.front, c.back]);

describe('one-line cards', () => {
  it('splits on " :: "', () => {
    expect(pairs('Capital of France? :: Paris')).toEqual([['Capital of France?', 'Paris']]);
  });

  it('strips list markers and task boxes from the question', () => {
    expect(pairs('- a :: 1\n* b :: 2\n12. c :: 3\n- [ ] d :: 4')).toEqual([
      ['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'],
    ]);
  });

  it('needs whitespace on both sides, so C++ scopes and URLs are left alone', () => {
    expect(pairs('Use std::vector for this.\nSee a::b and http://x.y')).toEqual([]);
  });

  it('ignores :: inside inline code and inline math', () => {
    expect(pairs('What does `a :: b` mean in Haskell? :: A type annotation')).toEqual([
      ['What does `a :: b` mean in Haskell?', 'A type annotation'],
    ]);
    expect(pairs('Text with `x :: y` only')).toEqual([]);
    expect(pairs('Math $a :: b$ only')).toEqual([]);
  });

  it('treats a double-backtick code span containing backticks as one span', () => {
    expect(pairs('Use ``a ` b ` c :: d`` here.')).toEqual([]);
    expect(pairs('What does ``a ` b :: c`` do? :: Nothing')).toEqual([['What does ``a ` b :: c`` do?', 'Nothing']]);
    expect(pairs('Use ``a ` b ==secret==`` here.')).toEqual([]);
  });

  it('ignores one-line HTML comments', () => {
    expect(pairs('<!-- todo :: later -->\nq :: a <!--SR:!2026-01-01,3,250-->')).toEqual([['q', 'a']]);
    expect(pairs('```html\n<!-- kept -->\n```\nQ: q\nA: `x` <!-- gone -->')).toEqual([['q', '`x`']]);
  });

  it('does not mistake money for math', () => {
    expect(pairs('Prices $5 :: $10')).toEqual([['Prices $5', '$10']]);
    expect(pairs('Cost in $ :: Around $5 or $10')).toEqual([['Cost in $', 'Around $5 or $10']]);
    expect(pairs('Display $$a :: b$$ only')).toEqual([]);
  });

  it('keeps later separators in the answer', () => {
    expect(pairs('q :: a :: b')).toEqual([['q', 'a :: b']]);
  });

  it('does not treat ":::" as a separator', () => {
    expect(pairs('q ::: a')).toEqual([]);
  });

  it('warns when a side is empty', () => {
    const r = parse('Question :: ');
    expect(r.cards).toEqual([]);
    expect(r.warnings).toEqual(['notes/test.md:1: "::" needs text on both sides']);
  });

  it('ignores card syntax inside fenced code blocks', () => {
    expect(pairs('```\nq :: a\nQ: x\nA: y\n==z==\n```\n~~~~\nq2 :: a2\n~~~~')).toEqual([]);
  });

  it('a fence only closes on a matching fence', () => {
    expect(pairs('````\n```\nq :: a\n```\n````\nreal :: card')).toEqual([['real', 'card']]);
  });

  it('records 1-based line numbers and the order within the note', () => {
    expect(parse('\n\nq :: a').cards[0]).toMatchObject({ line: 3, seq: 0 });
    expect(parse('a ==b== ==c==\nq :: a').cards.map((c) => [c.line, c.seq])).toEqual([[1, 0], [1, 1], [2, 2]]);
  });

  it('handles CRLF line endings and a BOM', () => {
    expect(pairs('\uFEFFq :: a\r\nq2 :: a2\r\n')).toEqual([['q', 'a'], ['q2', 'a2']]);
  });
});

describe('Q:/A: blocks', () => {
  it('reads a simple block', () => {
    expect(pairs('Q: What is 2+2?\nA: 4')).toEqual([['What is 2+2?', '4']]);
  });

  it('reads multi-line questions and answers', () => {
    expect(pairs('Q: Line one\nline two\nA: Answer one\nanswer two\n\nNot part of it')).toEqual([
      ['Line one\nline two', 'Answer one\nanswer two'],
    ]);
  });

  it('ends the answer at a blank line, but not inside a code fence', () => {
    const md = 'Q: Code?\nA: Here:\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter';
    expect(pairs(md)).toEqual([['Code?', 'Here:\n```js\nconst a = 1;\n\nconst b = 2;\n```']]);
  });

  it('ends the answer at the next Q:, a heading or a rule', () => {
    expect(pairs('Q: one\nA: 1\nQ: two\nA: 2\n# H\nQ: three\nA: 3\n---\ntext')).toEqual([
      ['one', '1'], ['two', '2'], ['three', '3'],
    ]);
  });

  it('allows blank lines and code inside the question', () => {
    expect(pairs('Q: What does this print?\n\n```py\nA: not an answer\n```\nA: Nothing')).toEqual([
      ['What does this print?\n\n```py\nA: not an answer\n```', 'Nothing'],
    ]);
  });

  it('does not parse :: or == inside a block as extra cards', () => {
    expect(pairs('Q: What is ==this==?\nA: x :: y')).toEqual([['What is ==this==?', 'x :: y']]);
  });

  it('warns about a Q: with no A: and keeps parsing after it', () => {
    const r = parse('Q: orphan\n\nq :: a\n\nQ: at the end');
    expect(r.cards.map((c) => c.front)).toEqual(['q']);
    expect(r.warnings).toEqual([
      'notes/test.md:1: "Q:" without a matching "A:"',
      'notes/test.md:5: "Q:" without a matching "A:"',
    ]);
  });

  it('warns about an empty answer', () => {
    expect(parse('Q: q\nA:\n\ntext').warnings).toEqual(['notes/test.md:1: "Q:" and "A:" both need text']);
  });

  it('only matches Q: at the start of a line', () => {
    expect(pairs('FAQ: something\nA: something else')).toEqual([]);
  });
});

describe('cloze deletions', () => {
  it('makes one card per highlight, revealing the others', () => {
    expect(pairs('The ==mitochondria== makes ==ATP==.')).toEqual([
      ['The ==[…]== makes ATP.', 'The ==mitochondria== makes ATP.'],
      ['The mitochondria makes ==[…]==.', 'The mitochondria makes ==ATP==.'],
    ]);
    expect(parse('The ==a== b').cards[0]!.kind).toBe('cloze');
  });

  it('uses the whole paragraph as context', () => {
    expect(pairs('First line\nwith ==gap== here\n\nOther paragraph')).toEqual([
      ['First line\nwith ==[…]== here', 'First line\nwith ==gap== here'],
    ]);
  });

  it('treats each list item as its own card context', () => {
    expect(pairs('- one ==a==\n- two ==b==').map((p) => p[0])).toEqual(['one ==[…]==', 'two ==[…]==']);
  });

  it('ignores == inside inline code and empty or spaced highlights', () => {
    expect(pairs('Use `a == b == c` to compare.\nif x == y and y == z\n====')).toEqual([]);
  });

  it('does not take a setext heading underline or a row of equals signs for a highlight', () => {
    expect(pairs('Title\n=====\n\n==========\n\nReal ==one== here')).toEqual([['Real ==[…]== here', 'Real ==one== here']]);
  });

  it('a :: line wins over highlights on the same line', () => {
    expect(pairs('What is ==this==? :: a card')).toEqual([['What is ==this==?', 'a card']]);
  });

  it('gives repeated hidden words distinct ids', () => {
    const ids = parse('==to be== or not ==to be==').cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('keeps existing cloze ids when another highlight is added', () => {
    const before = parse('The mitochondria makes ==ATP==.').cards[0]!.id;
    const after = parse('The ==mitochondria== makes ==ATP==.').cards.map((c) => c.id);
    expect(after).toContain(before);
  });
});

describe('headings as questions', () => {
  const md = '# Biology\n\nIntro text.\n\n## What is ATP?\n\nThe energy currency.\n\n- of the cell\n\n## Cards\n\nq :: a\n\n## Empty\n\n### Deep\n\nbody';

  it('is off by default', () => {
    expect(pairs(md)).toEqual([['q', 'a']]);
  });

  it('turns sections into cards, skipping empty ones and ones that hold cards', () => {
    expect(pairs(md, { headings: true })).toEqual([
      ['Biology', 'Intro text.'],
      ['Biology › What is ATP?', 'The energy currency.\n\n- of the cell'],
      ['q', 'a'],
      ['Biology › Empty › Deep', 'body'],
    ]);
    expect(parse(md, { headings: true }).cards[0]!.kind).toBe('heading');
  });

  it('keeps fenced code in the answer and ignores # inside fences', () => {
    expect(pairs('## Loop\n```sh\n# comment\nls\n```', { headings: true })).toEqual([
      ['Loop', '```sh\n# comment\nls\n```'],
    ]);
  });
});

describe('decks and tags', () => {
  it('names the deck after the note path', () => {
    expect(parseMarkdown('q :: a', 'Vault/bio/cells.md').cards[0]!.deck).toBe('Vault/bio/cells');
    expect(parseMarkdown('q :: a', 'README.markdown').cards[0]!.deck).toBe('README');
  });

  it('lets front matter set the deck', () => {
    expect(parse('---\ndeck: "Exams/Bio"\n---\nq :: a').cards[0]!.deck).toBe('Exams/Bio');
  });

  it('reads tags from front matter in inline, list and plain form', () => {
    expect(parse('---\ntags: [bio, "exam"]\n---\nq :: a').cards[0]!.tags).toEqual(['bio', 'exam']);
    expect(parse('---\ntags:\n  - bio\n  - "#exam"\ntitle: x\n---\nq :: a').cards[0]!.tags).toEqual(['bio', 'exam']);
    expect(parse('---\ntags: bio, exam\n---\nq :: a').cards[0]!.tags).toEqual(['bio', 'exam']);
  });

  it('collects inline #tags but not headings, code or numbers', () => {
    const md = '# Title\nSome #bio/cells text and `#notatag` and issue #12.\n```\n#!/bin/sh #nope\n```\nq :: a #exam';
    expect(parse(md).cards[0]!.tags).toEqual(['bio/cells', 'exam']);
  });

  it('collects inline #tags from inside Q:/A: blocks and cloze paragraphs too', () => {
    const md = 'Q: q #in-question\nA: a\nmore #in-answer\n\nFirst line\nsecond ==gap== #in-cloze\n\n- q2 :: a2 #in-line';
    expect(parse(md).cards[0]!.tags).toEqual(['in-question', 'in-answer', 'in-cloze', 'in-line']);
  });

  it('does not parse front matter content as cards', () => {
    expect(pairs('---\ntitle: a :: b\n---\nq :: a')).toEqual([['q', 'a']]);
  });

  it('treats an unclosed front matter fence as a rule', () => {
    expect(pairs('---\nq :: a')).toEqual([['q', 'a']]);
  });
});

describe('byNote', () => {
  it('sorts by deck, then note, then position, whatever order storage returns', () => {
    const cards = [...parseMarkdown('x ==1== ==2== ==3==', 'b.md').cards, ...parseMarkdown('q :: a', 'a.md').cards];
    const shuffled = [cards[2]!, cards[3]!, cards[0]!, cards[1]!];
    expect(shuffled.sort(byNote)).toEqual([cards[3], cards[0], cards[1], cards[2]]);
  });
});

describe('identity', () => {
  it('is stable across runs', () => {
    expect(hash('hello')).toBe(hash('hello'));
    expect(hash('hello')).not.toBe(hash('hellp'));
    expect(cardId('basic', 'What is ATP?')).toMatch(/^[0-9a-z]+$/);
  });

  it('ignores case and whitespace', () => {
    expect(normalize('  What   IS\tthis? ')).toBe('what is this?');
    expect(cardId('basic', 'What is ATP?')).toBe(cardId('basic', '  what is   atp? '));
  });

  it('does not depend on the answer, the file, the deck or the position', () => {
    const a = parseMarkdown('q :: old answer', 'a.md').cards[0]!;
    const b = parseMarkdown('---\ndeck: other\n---\n\n\n- q :: new answer', 'folder/b.md').cards[0]!;
    expect(a.id).toBe(b.id);
  });

  it('depends on the question and the card kind', () => {
    expect(cardId('basic', 'a + b')).not.toBe(cardId('basic', 'a - b'));
    expect(cardId('basic', 'x')).not.toBe(cardId('heading', 'x'));
  });

  it('skips duplicate questions within a note', () => {
    const r = parse('q :: a\nQ: q\nA: b');
    expect(r.cards).toHaveLength(1);
    expect(r.warnings).toEqual(['notes/test.md:2: duplicate question skipped']);
  });
});

describe('sample deck', () => {
  it('parses cleanly into every kind of card it claims to show', () => {
    const r = parseMarkdown(sample, 'sample.md');
    expect(r.warnings).toEqual([]);
    expect(r.cards.filter((c) => c.kind === 'basic')).toHaveLength(11);
    expect(r.cards.filter((c) => c.kind === 'cloze')).toHaveLength(3);
    expect(new Set(r.cards.map((c) => c.deck))).toEqual(new Set(['Learn recallmd in 2 minutes']));
    expect(r.cards.find((c) => c.front.startsWith('Is math'))!.back).toContain('$$');
  });

  it('never produces an empty side', () => {
    for (const c of parseMarkdown(sample, 'sample.md', { headings: true }).cards) {
      expect(c.front.trim()).not.toBe('');
      expect(c.back.trim()).not.toBe('');
    }
  });
});

describe('README example', () => {
  it('produces the cards the README says it does', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const example = /````markdown\n([\s\S]+?)````/.exec(readme)![1]!;
    const r = parseMarkdown(example, 'notes.md');
    expect(r.warnings).toEqual([]);
    expect(r.cards.map((c) => [c.kind, c.front])).toEqual([
      ['basic', 'What is the powerhouse of the cell?'],
      ['basic', 'What do ribosomes make?'],
      ['cloze', 'Plant cells have a ==[…]== made of cellulose.'],
      ['cloze', 'Plant cells have a cell wall made of ==[…]==.'],
      ['basic', 'What does this print?'],
    ]);
    expect(r.cards[4]!.back).toContain('print(len([1, 2, 3]))');
    expect(r.cards[0]).toMatchObject({ deck: 'Biology/Cells', tags: ['bio', 'exam'] });
  });
});
