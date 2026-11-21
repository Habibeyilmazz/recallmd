import { describe, expect, it, vi } from 'vitest';

// DOMPurify needs a DOM; only the parsing side of markdown.ts is used here.
vi.mock('dompurify', () => ({ default: { addHook() {}, sanitize: (html: string) => html } }));
const { neededImages, resolveImage } = await import('./media');
const { planImport } = await import('./importer');

const VAULT = ['Vault/attachments/cell.png', 'Vault/biology/cell.png', 'Vault/biology/img/heart diagram.jpg', 'Vault/other/deep/atom.svg'];

describe('resolveImage', () => {
  it('finds a path relative to the note first', () => {
    expect(resolveImage('img/heart diagram.jpg', 'Vault/biology/heart.md', VAULT)).toBe('Vault/biology/img/heart diagram.jpg');
    expect(resolveImage('../attachments/cell.png', 'Vault/biology/cells.md', VAULT)).toBe('Vault/attachments/cell.png');
    expect(resolveImage('./cell.png', 'Vault/biology/cells.md', VAULT)).toBe('Vault/biology/cell.png');
  });

  it('decodes %20 the way Markdown links write spaces', () => {
    expect(resolveImage('img/heart%20diagram.jpg', 'Vault/biology/heart.md', VAULT)).toBe('Vault/biology/img/heart diagram.jpg');
    expect(resolveImage('100%.png', 'a.md', ['100%.png'])).toBe('100%.png');
  });

  it('finds an Obsidian name anywhere in the vault, nearest to the note first', () => {
    expect(resolveImage('atom.svg', 'Vault/physics.md', VAULT)).toBe('Vault/other/deep/atom.svg');
    expect(resolveImage('cell.png', 'Vault/biology/sub/x.md', VAULT)).toBe('Vault/biology/cell.png');
    expect(resolveImage('cell.png', 'Vault/history/x.md', VAULT)).toBe('Vault/biology/cell.png'); // same distance: the shorter path
    expect(resolveImage('attachments/cell.png', 'Vault/biology/x.md', VAULT)).toBe('Vault/attachments/cell.png');
    expect(resolveImage('/attachments/cell.png', 'Vault/biology/x.md', VAULT)).toBe('Vault/attachments/cell.png');
  });

  it('ignores case when matching by name, and matches a whole name only', () => {
    expect(resolveImage('ATOM.SVG', 'Vault/a.md', VAULT)).toBe('Vault/other/deep/atom.svg');
    expect(resolveImage('om.svg', 'Vault/a.md', VAULT)).toBeUndefined();
  });

  it('falls back to the file name when the folders differ, as with files picked one by one', () => {
    expect(resolveImage('attachments/cell.png', 'cells.md', ['cell.png'])).toBe('cell.png');
  });

  it('only resolves images', () => {
    expect(resolveImage('notes.md', 'a.md', ['notes.md'])).toBeUndefined();
    expect(resolveImage('missing.png', 'Vault/a.md', VAULT)).toBeUndefined();
  });
});

describe('neededImages', () => {
  const note = [
    'Where is the nucleus? :: ![[cell.png|300]]',
    'What does this show? :: ![a heart](img/heart%20diagram.jpg)',
    'Missing? :: ![[gone.png]]',
    'Remote? :: ![x](https://example.org/a.png)',
    'Note embed? :: ![[Other note]]',
    '```',
    'In code? :: ![[atom.svg]]',
    '```',
  ].join('\n');
  const { upsert } = planImport([], () => false, [{ path: 'Vault/biology/heart.md', text: note }]);

  it('stores the added images the cards show and reports the ones not found', () => {
    expect(neededImages(upsert, VAULT, [])).toEqual({
      save: ['Vault/biology/cell.png', 'Vault/biology/img/heart diagram.jpg'],
      missing: ['Vault/biology/heart.md:3: image "gone.png" not found in what you added'],
    });
  });

  it('an image stored by an earlier import is not missing and is not stored again', () => {
    expect(neededImages(upsert, ['Vault/biology/cell.png'], ['Vault/biology/img/heart diagram.jpg', 'gone.png'])).toEqual({
      save: ['Vault/biology/cell.png'],
      missing: [],
    });
  });
});
