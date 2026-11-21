// Regenerates docs/screenshots/ by driving the real app: it imports the test
// vault, then studies for ten simulated days so the stats have something to show.
// Run with: npm run build && npm run preview   (in another terminal)
//           node scripts/screenshots.mjs
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const URL_BASE = 'http://localhost:4131/';
const out = (name) => fileURLToPath(new URL(`../docs/screenshots/${name}`, import.meta.url));
const vault = fileURLToPath(new URL('../e2e/fixtures/vault', import.meta.url));
const DAYS = 10;
const day = (n, hour = 9) => new Date(2026, 10, 21 - n, hour, 0);

const browser = await chromium.launch();
// reducedMotion: a screenshot must not catch the answer halfway through fading in.
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const page = await context.newPage();
const show = page.getByRole('button', { name: /Show answer/ });
const card = page.getByRole('article', { name: 'Flashcard' });

// A fixed, repeatable pattern of answers: mostly Good, some misses.
let n = 0;
const nextRating = () => '3331334323'[n++ % 10];

const done = page.getByRole('heading', { level: 2 });
/** Answers up to `limit` cards of whatever is on the review page. */
async function study(target, limit) {
  await target.goto(`${URL_BASE}#/review`);
  await target.reload();
  for (let i = 0; i < limit; i++) {
    await show.or(done).first().waitFor();
    if (!(await show.isVisible())) break;
    await target.keyboard.press('Space');
    await target.keyboard.press(nextRating());
  }
}

await page.clock.setFixedTime(day(DAYS - 1));
await page.goto(`${URL_BASE}#/settings`);
await page.getByLabel('New cards a day').fill('2');
await page.goto(URL_BASE);
await page.getByTestId('folder').setInputFiles(vault);
await page.getByRole('button', { name: /^Import/ }).click();
await page.getByText(/^Imported/).waitFor();

for (let d = DAYS - 1; d >= 1; d--) {
  await page.clock.setFixedTime(day(d));
  await study(page, 60);
}

// Today: three reviews in, then the screenshots.
await page.clock.setFixedTime(day(0));
await study(page, 3);
await page.goto(URL_BASE);
await page.getByRole('heading', { level: 1 }).waitFor();
await page.screenshot({ path: out('decks.png') });

// The review screenshot comes from a first run: the sample deck's card with code in its answer.
const fresh = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const first = await fresh.newPage();
await first.goto(URL_BASE);
await first.getByRole('link', { name: 'Study now' }).click();
const firstCard = first.getByRole('article', { name: 'Flashcard' });
await firstCard.waitFor();
for (let i = 0; i < 12 && !(await firstCard.getByText('several lines').isVisible()); i++) {
  await first.keyboard.press('Space');
  await first.keyboard.press('3');
}
await first.keyboard.press('Space');
await firstCard.locator('pre .hljs-keyword').first().waitFor();
await first.screenshot({ path: out('review.png') });
await fresh.close();

await page.goto(`${URL_BASE}#/stats`);
await page.getByRole('heading', { name: 'Stats' }).waitFor();
await page.screenshot({ path: out('stats.png'), fullPage: true });

await page.goto(`${URL_BASE}#/cards`);
await page.getByRole('heading', { name: 'Cards' }).waitFor();
await page.getByRole('searchbox').fill('#bio');
await page.getByText(/^\d+ cards?$/).waitFor();
await page.screenshot({ path: out('cards.png') });

await page.goto(URL_BASE);
await page.getByTestId('files').setInputFiles({
  name: 'chemistry.md',
  mimeType: 'text/markdown',
  buffer: Buffer.from('What is the pH of pure water? :: 7\nAvogadro\'s number is ==6.022 × 10²³==.\nQ: orphan question\n'),
});
await page.getByRole('dialog').waitFor();
await page.screenshot({ path: out('import.png') });
await page.keyboard.press('Escape');

// Phone-sized and dark: a first run again, first card answered.
const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: 'dark' });
const small = await phone.newPage();
await small.goto(URL_BASE);
await small.getByRole('link', { name: 'Study now' }).click();
await small.getByRole('article', { name: 'Flashcard' }).waitFor();
await small.keyboard.press('Space');
await small.getByRole('button', { name: /Good/ }).waitFor();
await small.screenshot({ path: out('review-phone-dark.png') });

await browser.close();
