// Card Markdown -> safe HTML. KaTeX and highlight.js are loaded only when a card needs them.
import DOMPurify from 'dompurify';
import type { HLJSApi } from 'highlight.js';
import { Marked } from 'marked';

let katex: typeof import('katex').default | undefined;
let hljs: HLJSApi | undefined;

/** Starts loading whatever `md` needs that is not loaded yet. Null when nothing is missing. */
export function loadRenderers(md: string): Promise<unknown> | null {
  const jobs: Promise<unknown>[] = [];
  if (!katex && md.includes('$')) {
    jobs.push(import('katex').then((m) => (katex = m.default)), import('katex/dist/katex.min.css'));
  }
  if (!hljs && /```|~~~/.test(md)) {
    jobs.push(import('highlight.js/lib/common').then((m) => (hljs = m.default)));
  }
  return jobs.length ? Promise.all(jobs) : null;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function math(tex: string, displayMode: boolean): string {
  if (!katex) return `<code>${escapeHtml(tex)}</code>`;
  return katex.renderToString(tex, { displayMode, throwOnError: false });
}

const marked = new Marked({
  gfm: true,
  breaks: true, // like Obsidian: a single newline is a line break
  renderer: {
    code({ text, lang }) {
      const language = lang?.trim().split(/\s+/)[0] ?? '';
      const body = hljs && language && hljs.getLanguage(language) ? hljs.highlight(text, { language }).value : escapeHtml(text);
      return `<pre><code>${body}</code></pre>`;
    },
    // Only web images can be shown: files next to a note (vault attachments) are not imported.
    image({ href, text }) {
      if (!/^https?:\/\//i.test(href)) return `<em>[image: ${escapeHtml(text || href)}]</em>`;
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}">`;
    },
  },
  extensions: [
    {
      name: 'mark',
      level: 'inline',
      start: (src) => src.indexOf('=='),
      tokenizer(src) {
        const m = /^==(?=\S)([^\n]+?)(?<=\S)==/.exec(src);
        if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]!) };
      },
      renderer(token) {
        return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
      },
    },
    {
      name: 'blockMath',
      level: 'block',
      start: (src) => {
        const i = src.search(/(?:^|\n)\$\$/);
        return i < 0 ? undefined : src[i] === '\n' ? i + 1 : i;
      },
      tokenizer(src) {
        const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
        if (m) return { type: 'blockMath', raw: m[0], text: m[1]!.trim() };
      },
      renderer: (token) => math(token.text, true),
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: (src) => src.indexOf('$'),
      tokenizer(src) {
        const display = /^\$\$([^\n]+?)\$\$/.exec(src);
        if (display) return { type: 'inlineMath', raw: display[0], text: display[1]!.trim(), display: true };
        // Pandoc's rule, so "$5 and $10" stays text: no space inside the dollars, no digit after.
        const m = /^\$(?!\s)((?:\\.|[^\\\n$])+?)(?<!\s)\$(?!\d)/.exec(src);
        if (m) return { type: 'inlineMath', raw: m[0], text: m[1]!, display: false };
      },
      renderer: (token) => math(token.text, token.display),
    },
    {
      // Obsidian [[Page]] and [[Page|label]] links: there is no page to go to, so show the label.
      // ![[file]] embeds are not imported either, so they are named instead of shown.
      name: 'wikilink',
      level: 'inline',
      start: (src) => {
        const i = src.search(/!?\[\[/);
        return i < 0 ? undefined : i;
      },
      tokenizer(src) {
        const m = /^(!?)\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], text: m[1] ? m[2]! : (m[3] ?? m[2]!), embed: !!m[1] };
      },
      renderer: (token) => (token.embed ? `<em>[embed: ${escapeHtml(token.text)}]</em>` : escapeHtml(token.text)),
    },
  ],
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Renders note Markdown, which is untrusted input, to sanitized HTML. */
export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }), { FORBID_TAGS: ['style', 'form', 'input', 'button'] });
}
