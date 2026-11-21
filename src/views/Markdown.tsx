import { useEffect, useMemo, useRef, useState } from 'react';
import { getImage, imagePaths } from '../lib/db';
import { loadRenderers, renderMarkdown } from '../lib/markdown';
import { resolveImage } from '../lib/media';

/**
 * Renders card Markdown from the note at `source`. Shows plain code and raw TeX for a moment
 * while KaTeX or highlight.js load, and an image's name until it is read from storage.
 */
export function Markdown({ text, source }: { text: string; source: string }) {
  const [loaded, setLoaded] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    loadRenderers(text)?.then(
      () => live && setLoaded((n) => n + 1),
      () => undefined, // offline before the first full load: keep the plain rendering
    );
    return () => {
      live = false;
    };
  }, [text]);
  // `loaded` is a dependency on purpose: render again once the libraries are in.
  const html = useMemo(() => renderMarkdown(text), [text, loaded]);

  // Swap each local image's placeholder for the stored file. One not imported keeps its name.
  useEffect(() => {
    const slots = [...(box.current?.querySelectorAll<HTMLElement>('[data-ref]') ?? [])];
    if (!slots.length) return;
    let live = true;
    const urls: string[] = [];
    (async () => {
      const paths = await imagePaths();
      for (const slot of slots) {
        const path = resolveImage(slot.dataset.ref ?? '', source, paths);
        const file = path && (await getImage(path));
        if (!live) return;
        if (!file) continue;
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        urls.push(img.src);
        img.alt = slot.dataset.alt || path.split('/').pop()!;
        if (slot.dataset.width) img.width = Number(slot.dataset.width);
        slot.replaceWith(img);
      }
    })().catch(() => undefined); // storage unreadable: the names stay
    return () => {
      live = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [html, source]);

  return <div className="md" ref={box} dangerouslySetInnerHTML={{ __html: html }} />;
}
