import { describe, expect, it, vi } from 'vitest';

// DOMPurify needs a DOM, which these tests do not have; sanitizing is covered by the end-to-end tests.
vi.mock('dompurify', () => ({ default: { addHook() {}, sanitize: (html: string) => html } }));
const { renderMarkdown } = await import('./markdown');

describe('wikilinks', () => {
  it('show their label and name embeds', () => {
    expect(renderMarkdown('[[Page]] [[Page|label]] ![[a.png]]')).toBe('<p>Page label <em>[embed: a.png]</em></p>\n');
  });

  it('render in linear time on a line of unclosed links', () => {
    const started = performance.now();
    renderMarkdown('![[a|'.repeat(50_000));
    expect(performance.now() - started).toBeLessThan(1500); // was about 20 s
  });
});
