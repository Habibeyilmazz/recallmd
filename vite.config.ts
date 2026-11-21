import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// Notes are untrusted input rendered as HTML. They are sanitized, and this policy is the
// second line of defence: no inline or remote scripts, no connections to other origins.
// Build only, because the dev server needs inline scripts for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // KaTeX positions glyphs with inline styles
  "img-src 'self' data: blob: https: http:", // images linked from your notes
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp: Plugin = {
  name: 'recallmd-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
};

export default defineConfig({
  // Relative base so the build works at any path, e.g. GitHub Pages project sites.
  base: './',
  plugins: [
    react(),
    csp,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      // Fonts ship as woff2 only in the offline cache; every supported browser reads it.
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      manifest: {
        name: 'recallmd',
        short_name: 'recallmd',
        description: 'Turn Markdown notes into spaced-repetition flashcards.',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        background_color: '#f2f4f6',
        theme_color: '#17212b',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: { include: ['src/**/*.test.ts'] },
});
