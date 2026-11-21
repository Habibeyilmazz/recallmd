// Local images in notes: which stored file a reference such as ![[cell.png]] or
// ![](../img/cell.png) means. Pure functions, no DOM.
import { imageRefs, isImage } from './markdown';
import type { Card } from './parser';

/** `ref` joined to the folder `dir`, without `.` and `..` parts. */
function join(dir: string, ref: string): string {
  const out: string[] = [];
  for (const part of `${dir}/${ref}`.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

/**
 * The path in `paths` that an image reference in the note at `notePath` means, like Obsidian
 * resolves it: relative to the note first, then any file whose path ends with the reference
 * (closest to the note, then the shortest), then any file with the same name.
 */
export function resolveImage(ref: string, notePath: string, paths: readonly string[]): string | undefined {
  let name = ref.trim();
  try {
    name = decodeURI(name); // Markdown links write spaces as %20
  } catch {
    // a lone "%" is part of the name
  }
  if (!isImage(name)) return;
  const dir = notePath.split('/').slice(0, -1);
  const relative = join(dir.join('/'), name);
  if (paths.includes(relative)) return relative;

  const shared = (path: string) => {
    const parts = path.split('/');
    let n = 0;
    while (n < parts.length - 1 && n < dir.length && parts[n] === dir[n]) n++;
    return n;
  };
  const endingWith = (tail: string) => {
    const want = tail.toLowerCase();
    return paths.filter((p) => {
      const lower = p.toLowerCase();
      return lower === want || lower.endsWith(`/${want}`);
    });
  };
  const tail = name.replace(/^(?:\.{0,2}\/)+/, '');
  const found = endingWith(tail);
  const matches = found.length ? found : endingWith(tail.split('/').pop()!);
  return matches.sort((a, b) => shared(b) - shared(a) || a.length - b.length)[0];
}

/**
 * The images the cards show: which of the `added` files to store, and the references that
 * match neither an added nor an already `stored` image.
 */
export function neededImages(cards: Card[], added: readonly string[], stored: readonly string[]): { save: string[]; missing: string[] } {
  const all = [...new Set([...added, ...stored])];
  const fresh = new Set(added);
  const save = new Set<string>();
  const missing = new Set<string>();
  for (const card of cards) {
    for (const ref of new Set([...imageRefs(card.front), ...imageRefs(card.back)])) {
      const path = resolveImage(ref, card.source, all);
      if (!path) missing.add(`${card.source}:${card.line}: image "${ref}" not found in what you added`);
      else if (fresh.has(path)) save.add(path);
    }
  }
  return { save: [...save].sort(), missing: [...missing] };
}
