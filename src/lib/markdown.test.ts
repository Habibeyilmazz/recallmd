import { describe, expect, it, vi } from 'vitest';

// DOMPurify needs a DOM, which these tests do not have; sanitizing is covered by the end-to-end tests.
vi.mock('dompurify', () => ({ default: { addHook() {}, sanitize: (html: string) => html } }));
const { imageRefs, renderMarkdown } = await import('./markdown');

describe('wikilinks', () => {
  it('show their label and name embeds of other notes', () => {
    expect(renderMarkdown('[[Page]] [[Page|label]] ![[Other note]]')).toBe('<p>Page label <em>[embed: Other note]</em></p>\n');
  });

  it('render in linear time on a line of unclosed links', () => {
    const started = performance.now();
    renderMarkdown('![[a|'.repeat(50_000));
    expect(performance.now() - started).toBeLessThan(5000); // was about 20 s; about 1 s now, so a busy machine does not fail it
  });
});

describe('local images', () => {
  it('leave a placeholder naming the image, for the view to fill in', () => {
    expect(renderMarkdown('![[a b.png|300]] ![[c.png|A cell]] ![Heart](img/h.jpg)')).toBe(
      '<p><em data-ref="a b.png" data-alt="" data-width="300">[image: a b.png]</em> ' +
        '<em data-ref="c.png" data-alt="A cell">[image: A cell]</em> ' +
        '<em data-ref="img/h.jpg" data-alt="Heart">[image: Heart]</em></p>\n',
    );
  });

  it('escape the reference in the placeholder', () => {
    expect(renderMarkdown('![[x"><script>.png]]')).toContain('data-ref="x&#34;&#62;&#60;script&#62;.png"');
  });

  it('are listed by imageRefs, but not web images, other files or anything in code', () => {
    const md = '![[a.png|200]] ![x](<my pic.jpg>) ![w](https://e.org/w.png) ![[Note]] ![p](doc.pdf) `![[b.png]]`\n\n```\n![[c.png]]\n```';
    expect(imageRefs(md)).toEqual(['a.png', 'my pic.jpg']);
  });
});
