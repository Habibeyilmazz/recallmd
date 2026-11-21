// Markdown -> flashcards. Pure functions, no DOM.

export type CardKind = 'basic' | 'cloze' | 'heading';

export interface Card {
  /** Stable identity: hash of kind + normalized question, independent of file path and answer. */
  id: string;
  kind: CardKind;
  /** Markdown shown as the question. */
  front: string;
  /** Markdown shown as the answer. */
  back: string;
  deck: string;
  tags: string[];
  /** Path of the note the card came from. */
  source: string;
  /** 1-based line in the source. */
  line: number;
  /** Position among the note's cards; several cards can share a line. */
  seq: number;
}

/** Deck order, then the order the cards appear in their notes. */
export function byNote(a: Card, b: Card): number {
  return a.deck.localeCompare(b.deck) || a.source.localeCompare(b.source) || a.seq - b.seq;
}

export interface ParseOptions {
  /** Turn headings into questions and their section text into answers. */
  headings?: boolean;
}

export interface ParseResult {
  cards: Card[];
  warnings: string[];
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const QUESTION = /^Q:(?:\s|$)/;
const ANSWER = /^A:(?:\s|$)/;
/** Obsidian Spaced Repetition's multi-line separator: a line of `?`, or `??` for a card both ways. */
const SR_SEPARATOR = /^\s*(\?\??)\s*$/;
// The hidden text may not start or end with a space or "=", so "a == b" and a "=====" underline are not highlights.
const CLOZE = /==(?=[^\s=])(.+?)(?<=[^\s=])==/g;
const TAG = /(?:^|\s)#([\p{L}][\p{L}\p{N}_/-]*)/gu;

/** cyrb53: fast 53-bit string hash, plenty for a personal card collection. */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Case and whitespace do not change a card's identity; wording does. */
export function normalize(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function cardId(kind: CardKind, question: string): string {
  return hash(`${kind}\n${normalize(question)}`);
}

/**
 * Inline math, by Pandoc's rule: no space just inside the dollars and no digit after the
 * closing one, so "$5 and $10" is money. The renderer uses the same pattern, so what is
 * hidden from the parser is exactly what gets rendered as math.
 */
export const INLINE_MATH = String.raw`\$(?!\s)((?:\\.|[^\\\n$])+?)(?<!\s)\$(?!\d)`;

// A code span closes on a backtick run of the same length, so ``a ` b`` is one span.
const INERT = new RegExp(String.raw`(\`+)[^\n]*?[^\`\n]\1(?!\`)|\$\$[^\n]+?\$\$|${INLINE_MATH}`, 'g');

/** Blank out inline code and inline math so card syntax inside them is ignored. Length is preserved. */
function mask(line: string): string {
  return line.replace(INERT, (m) => '\0'.repeat(m.length));
}

/** The first " :: " (or " ::: ", which also makes the reversed card) outside code and math. */
function separator(line: string): { index: number; length: number } | undefined {
  const m = /\s(:::?)(?=\s)/.exec(mask(line));
  return m ? { index: m.index, length: m[0].length } : undefined;
}

function closesFence(line: string, open: string): boolean {
  const m = FENCE.exec(line);
  return !!m && m[1]![0] === open[0] && m[1]!.length >= open.length && line.trim() === m[1];
}

function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/^#/, '').trim();
}

/** A deck path with no empty or blank folder names, which would show as nameless rows. */
const cleanDeck = (path: string) => path.split('/').map((p) => p.trim()).filter(Boolean).join('/');

/** Reads only what recallmd uses from YAML front matter: `tags` and `deck`. */
function readFrontMatter(lines: string[]): { tags: string[]; deck?: string } {
  const tags: string[] = [];
  let deck: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const m = /^([\w-]+):\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'deck' && value) deck = cleanDeck(unquote(value));
    if (key === 'tags' || key === 'tag') {
      if (value) {
        tags.push(...value.replace(/^\[|\]$/g, '').split(/[,\s]+/));
      } else {
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]!)) {
          tags.push(lines[++i]!.replace(/^\s*-\s+/, ''));
        }
      }
    }
  }
  return { tags: tags.map(unquote).filter(Boolean), deck: deck || undefined };
}

/** Removes `<!-- ... -->` from one line. A loop, not a regex: `/<!--.*?-->/g` is quadratic on unclosed comments. */
function dropComments(line: string): string {
  let out = '';
  let pos = 0;
  for (;;) {
    const open = line.indexOf('<!--', pos);
    const close = open < 0 ? -1 : line.indexOf('-->', open + 4);
    if (close < 0) return out + line.slice(pos);
    out += line.slice(pos, open);
    pos = close + 3;
  }
}

interface Draft {
  kind: CardKind;
  /** Text the id is derived from. */
  key: string;
  front: string;
  back: string;
  line: number;
}

/** Text a paragraph's cloze cards may hold in all: each card copies the paragraph twice. */
const CLOZE_BUDGET = 2_000_000;

function clozeDrafts(unit: string, line: number): Draft[] | string {
  const masked = mask(unit);
  const hits = [...masked.matchAll(CLOZE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  if (!hits.length) return [];
  // A long paragraph full of highlights would need gigabytes and crash the tab.
  if (hits.length * unit.length > CLOZE_BUDGET) return `${hits.length} highlights in one paragraph is too many; split it up`;
  const hidden = hits.map((h) => unit.slice(h.start + 2, h.end - 2));
  // Rebuild the unit keeping `==` around at most one highlight.
  const build = (target: number, replacement?: string) => {
    let out = '';
    let pos = 0;
    hits.forEach((h, n) => {
      out += unit.slice(pos, h.start);
      out += n === target ? `==${replacement ?? hidden[n]}==` : hidden[n];
      pos = h.end;
    });
    return out + unit.slice(pos);
  };
  const plain = build(-1);
  const seen = new Map<string, number>();
  return hits.map((_, n) => {
    const answer = normalize(hidden[n]!);
    const nth = seen.get(answer) ?? 0;
    seen.set(answer, nth + 1);
    // Identity = sentence + hidden text, so adding another highlight keeps existing cards.
    return { kind: 'cloze', key: `${plain}\n${answer}\n${nth}`, front: build(n, '[…]'), back: build(n), line };
  });
}

export function parseMarkdown(text: string, source: string, options: ParseOptions = {}): ParseResult {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const warnings: string[] = [];
  const drafts: Draft[] = [];
  let meta: { tags: string[]; deck?: string } = { tags: [] };
  let i = 0;

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === '---');
    if (end > 0) {
      meta = readFrontMatter(lines.slice(1, end));
      i = end + 1;
    }
  }

  // Everywhere outside code fences: drop one-line HTML comments (they are not note text,
  // and Obsidian plugins keep data in them) and collect inline #tags.
  const tags = new Set(meta.tags);
  for (let n = i; n < lines.length; n++) {
    const fence = FENCE.exec(lines[n]!);
    if (fence) {
      n++;
      while (n < lines.length && !closesFence(lines[n]!, fence[1]!)) n++;
      continue;
    }
    if (lines[n]!.includes('<!--')) lines[n] = dropComments(lines[n]!).trimEnd();
    for (const m of mask(lines[n]!).matchAll(TAG)) tags.add(m[1]!);
  }
  const sections: { front: string; line: number; start: number; end: number }[] = [];
  const trail: { level: number; text: string }[] = [];
  let noSeparatorBefore = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    const fence = FENCE.exec(line);
    if (fence) {
      i++;
      while (i < lines.length && !closesFence(lines[i]!, fence[1]!)) i++;
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      while (trail.length && trail[trail.length - 1]!.level >= level) trail.pop();
      trail.push({ level, text: heading[2]! });
      if (sections.length) sections[sections.length - 1]!.end = i;
      sections.push({ front: trail.map((t) => t.text).join(' › '), line: i + 1, start: i + 1, end: lines.length });
      i++;
      continue;
    }

    if (QUESTION.test(line)) {
      const block = readQuestionBlock(lines, i);
      if (typeof block === 'string') {
        warnings.push(`${source}:${i + 1}: ${block}`);
        i++;
      } else {
        drafts.push({ kind: 'basic', key: block.front, front: block.front, back: block.back, line: i + 1 });
        i = block.next;
      }
      continue;
    }

    if (!line.trim() || RULE.test(line)) {
      i++;
      continue;
    }

    const sep = separator(line);
    if (sep) {
      const front = line.slice(0, sep.index).replace(LIST_MARKER, '').trim();
      const back = line.slice(sep.index + sep.length).trim();
      const both = sep.length === 4;
      if (front && back) drafts.push(...basic(front, back, both, i + 1));
      else warnings.push(`${source}:${i + 1}: "${both ? ':::' : '::'}" needs text on both sides`);
      i++;
      continue;
    }

    // Obsidian Spaced Repetition multi-line card: the paragraph above a `?` line asks, the lines below answer.
    // Rescanning a paragraph already known to have no `?` line would be quadratic on a long list.
    let q = i + 1;
    if (q < noSeparatorBefore) q = noSeparatorBefore;
    else while (q < lines.length && lines[q]!.trim() && !SR_SEPARATOR.test(lines[q]!) && !FENCE.test(lines[q]!) && !HEADING.test(lines[q]!)) q++;
    const srSep = q < lines.length ? SR_SEPARATOR.exec(lines[q]!) : null;
    if (!srSep) noSeparatorBefore = q;
    if (srSep) {
      const front = lines.slice(i, q).join('\n').trim();
      const answer = readAnswer(lines, q + 1, '');
      if (answer.text) drafts.push(...basic(front, answer.text, srSep[1] === '??', i + 1));
      else warnings.push(`${source}:${q + 1}: "${srSep[1]}" needs an answer on the next line`);
      i = answer.next;
      continue;
    }

    // A cloze unit is one list item or one paragraph.
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (!next.trim() || FENCE.test(next) || HEADING.test(next) || QUESTION.test(next) || RULE.test(next)) break;
      if (LIST_MARKER.test(next) || separator(next)) break;
      j++;
    }
    const unit = [line.replace(LIST_MARKER, ''), ...lines.slice(i + 1, j)].join('\n').trim();
    const cloze = clozeDrafts(unit, i + 1);
    if (typeof cloze === 'string') warnings.push(`${source}:${i + 1}: ${cloze}`);
    else drafts.push(...cloze);
    i = j;
  }

  if (options.headings) {
    for (const s of sections) {
      const back = lines.slice(s.start, s.end).join('\n').trim();
      // Sections that already hold explicit cards are notes about those cards, not an answer.
      const hasCards = drafts.some((d) => d.line > s.start && d.line <= s.end);
      if (back && !hasCards) drafts.push({ kind: 'heading', key: s.front, front: s.front, back, line: s.line });
    }
    drafts.sort((a, b) => a.line - b.line);
  }

  // The Obsidian Spaced Repetition plugin files a note tagged #flashcards/a/b under the deck a/b.
  const tagDeck = cleanDeck([...tags].find((t) => /^flashcards\//i.test(t))?.slice(11) ?? '');
  const deck = meta.deck ?? (tagDeck || cleanDeck(source.replace(/\.(md|markdown|txt)$/i, '')) || 'Notes');
  const cards: Card[] = [];
  const ids = new Set<string>();
  for (const d of drafts) {
    const id = cardId(d.kind, d.key);
    if (ids.has(id)) {
      warnings.push(`${source}:${d.line}: duplicate question skipped`);
      continue;
    }
    ids.add(id);
    cards.push({ id, kind: d.kind, front: d.front, back: d.back, deck, tags: [...tags], source, line: d.line, seq: cards.length });
  }
  return { cards, warnings };
}

/** Parses a `Q:` … `A:` block starting at `start`. Returns an error message if it is malformed. */
function readQuestionBlock(lines: string[], start: number): { front: string; back: string; next: number } | string {
  const front = [lines[start]!.slice(2)];
  let fence: string | undefined;
  let j = start + 1;
  for (; j < lines.length; j++) {
    const l = lines[j]!;
    if (fence) {
      if (closesFence(l, fence)) fence = undefined;
    } else if (FENCE.test(l)) {
      fence = FENCE.exec(l)![1];
    } else if (ANSWER.test(l)) {
      break;
    } else if (QUESTION.test(l) || HEADING.test(l)) {
      return '"Q:" without a matching "A:"';
    }
    front.push(l);
  }
  if (j >= lines.length) return '"Q:" without a matching "A:"';

  const answer = readAnswer(lines, j + 1, lines[j]!.slice(2));
  const q = front.join('\n').trim();
  if (!q || !answer.text) return '"Q:" and "A:" both need text';
  return { front: q, back: answer.text, next: answer.next };
}

/** Reads an answer from `start` to the first blank line outside a code fence. */
function readAnswer(lines: string[], start: number, first: string): { text: string; next: number } {
  const back = [first];
  let fence: string | undefined;
  let k = start;
  for (; k < lines.length; k++) {
    const l = lines[k]!;
    if (fence) {
      if (closesFence(l, fence)) fence = undefined;
    } else if (FENCE.test(l)) {
      fence = FENCE.exec(l)![1];
    } else if (!l.trim() || QUESTION.test(l) || HEADING.test(l) || RULE.test(l)) {
      break;
    }
    back.push(l);
  }
  return { text: back.join('\n').trim(), next: k };
}

/** A question/answer pair, plus the reversed card when it goes both ways. */
function basic(front: string, back: string, both: boolean, line: number): Draft[] {
  const card: Draft = { kind: 'basic', key: front, front, back, line };
  return both ? [card, { kind: 'basic', key: back, front: back, back: front, line }] : [card];
}
