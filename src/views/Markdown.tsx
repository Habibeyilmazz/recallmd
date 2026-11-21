import { useEffect, useMemo, useState } from 'react';
import { loadRenderers, renderMarkdown } from '../lib/markdown';

/** Renders card Markdown. Shows plain code and raw TeX for a moment while KaTeX or highlight.js load. */
export function Markdown({ text }: { text: string }) {
  const [loaded, setLoaded] = useState(0);
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
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
