// Renders public/icon.svg to the PNG sizes the web app manifest needs.
// Run with: node scripts/make-icons.mjs   (only after changing the SVG; the PNGs are committed)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const render = async (name, size, source) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
  await page.screenshot({ path: fileURLToPath(new URL(`../public/${name}`, import.meta.url)), omitBackground: true });
};
await render('icon-192.png', 192, svg);
await render('icon-512.png', 512, svg);
// Maskable icons are cropped by the OS, so the background must reach the corners.
await render('icon-maskable-512.png', 512, svg.replace('rx="96"', 'rx="0"'));
await browser.close();
