// Records docs/demo.gif from the real app: first run, sample deck, a short review by keyboard.
// Run with: npm run build && npm run preview   (in another terminal), then node scripts/demo.mjs
// Needs ffmpeg on the PATH.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const dir = mkdtempSync(join(tmpdir(), 'recallmd-demo-'));
const gif = fileURLToPath(new URL('../docs/demo.gif', import.meta.url));
const size = { width: 900, height: 600 };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, recordVideo: { dir, size }, reducedMotion: 'reduce' });
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

await page.goto('http://localhost:4131/');
await page.getByRole('heading', { level: 1 }).waitFor();
await pause(1800);
await page.getByRole('link', { name: /Study|Review/ }).first().click();
for (const rating of ['3', '3', '4', '3', '2']) {
  await page.getByRole('button', { name: /Show answer/ }).waitFor();
  await pause(1200);
  await page.keyboard.press('Space');
  await pause(1500);
  await page.keyboard.press(rating);
}
await pause(800);
await context.close();
await browser.close();

const video = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
execFileSync('ffmpeg', ['-y', '-i', video, '-vf', 'fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', gif], { stdio: 'ignore' });
console.log('wrote', gif);
