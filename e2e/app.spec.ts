import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from 'playwright/test';

const VAULT = fileURLToPath(new URL('./fixtures/vault', import.meta.url));
const IMAGES = fileURLToPath(new URL('./fixtures/images', import.meta.url));
const md = (name: string, text: string) => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(text) });

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('to study today');
}

/** Opens a deck (or the Study now link) and waits for the first card, so key presses land on it. */
async function study(page: Page, link: string | RegExp) {
  await page.getByRole('link', { name: link }).click();
  const card = page.getByRole('article', { name: 'Flashcard' });
  await expect(card).toBeVisible();
  return card;
}

async function importFiles(page: Page, files: ReturnType<typeof md>[]) {
  await page.getByTestId('files').setInputFiles(files);
  return page.getByRole('dialog');
}

test('first run opens with the sample deck', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('10 cards to study today');
  await expect(page.getByRole('link', { name: /Learn recallmd in 2 minutes/ })).toContainText('14 new');
});

test('review with the keyboard: reveal, rate, undo', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Tab'); // keyboard only from here on
  await page.getByRole('link', { name: 'Study now' }).press('Enter');
  const card = page.getByRole('article', { name: 'Flashcard' });
  await expect(card).toContainText('Which two characters');
  await expect(card).not.toContainText('Two colons');
  await expect(page.getByText('10 to go')).toBeVisible();

  await page.keyboard.down('Space');
  await page.keyboard.down('Space'); // held down: the auto-repeat must not rate the card
  await page.keyboard.up('Space');
  await expect(card).toContainText('Two colons');
  await expect(page.getByRole('button', { name: /Again/ })).toBeVisible();
  await expect(page.getByText('10 to go')).toBeVisible();

  await page.keyboard.press('4'); // Easy: gone until another day
  await expect(card).toContainText('Which key shows the answer');
  await expect(page.getByText('9 to go')).toBeVisible();

  await page.keyboard.press('z');
  await expect(card).toContainText('Which two characters');
  await expect(page.getByText('10 to go')).toBeVisible();

  await page.keyboard.press('Enter');
  await page.keyboard.press('1'); // Again: comes back in this session
  await expect(card).toContainText('Which key shows the answer');
  await expect(page.getByText('10 to go')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('10 cards to study today');
  await expect(page.getByText('1 of 20 reviews')).toBeVisible();
});

test('suspend a card while reviewing, find it on the Cards page, and bring it back', async ({ page }) => {
  await open(page);
  const card = await study(page, 'Study now');
  await expect(card).toContainText('Which two characters');
  await page.keyboard.press('s');
  await expect(card).toContainText('Which key shows the answer');
  await expect(page.getByText('9 to go')).toBeVisible();
  await page.keyboard.press('z');
  await expect(card).toContainText('Which two characters');
  await expect(page.getByText('10 to go')).toBeVisible();
  await page.getByRole('button', { name: 'Suspend card' }).click();
  await expect(card).toContainText('Which key shows the answer');
  await expect(page.getByRole('button', { name: 'Undo last suspend' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: /Learn recallmd in 2 minutes/ })).toContainText('13 new');

  await page.getByRole('link', { name: 'Cards', exact: true }).click();
  await expect(page).toHaveTitle('Cards | recallmd');
  await expect(page.getByRole('status')).toHaveText('14 cards');
  await page.getByRole('combobox', { name: 'Show' }).selectOption('Suspended');
  await expect(page.getByRole('status')).toHaveText('1 card');
  await expect(page.getByRole('listitem')).toContainText('Which two characters');

  await page.getByRole('combobox', { name: 'Show' }).selectOption('All cards');
  await page.getByRole('searchbox', { name: 'Search' }).fill('takes BACK');
  await expect(page.getByRole('status')).toHaveText('1 card');
  await page.getByRole('button', { name: /^Suspend: Which key takes back/ }).click();
  await page.reload();
  await page.getByRole('combobox', { name: 'Show' }).selectOption('Suspended');
  await expect(page.getByRole('status')).toHaveText('2 cards');

  await page.getByRole('link', { name: 'Stats' }).click();
  await page.getByRole('link', { name: '2 suspended' }).click();
  await expect(page.getByRole('status')).toHaveText('2 cards');
  await page.getByRole('button', { name: /^Unsuspend: Which two characters/ }).click();
  await expect(page.getByRole('status')).toHaveText('1 card');
  await page.getByRole('link', { name: 'Decks' }).click();
  await expect(page.getByRole('link', { name: /Learn recallmd in 2 minutes/ })).toContainText('13 new');
});

test('suspend every card a search finds, then bring them all back', async ({ page }) => {
  await open(page);
  await page.getByRole('link', { name: 'Cards', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Suspend (all )?\d+ card/ })).toHaveCount(0); // nothing narrowed yet
  await page.getByRole('searchbox', { name: 'Search' }).fill('which key');
  await expect(page.getByRole('status')).toHaveText('3 cards');
  await page.getByRole('button', { name: /^Suspend: Which key shows/ }).click();
  await page.getByRole('button', { name: 'Suspend 2 cards' }).click();
  const bulk = page.getByRole('button', { name: 'Unsuspend all 3 cards' });
  await expect(bulk).toBeFocused();
  await page.getByRole('link', { name: 'Decks' }).click();
  await expect(page.getByRole('link', { name: /Learn recallmd in 2 minutes/ })).toContainText('11 new');

  await page.getByRole('link', { name: 'Cards', exact: true }).click();
  await page.getByRole('combobox', { name: 'Show' }).selectOption('Suspended');
  await page.getByRole('button', { name: 'Unsuspend all 3 cards' }).click();
  await expect(page.getByRole('status')).toHaveText('0 cards');
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeFocused();
});

test('a pressed review button hands the focus on instead of dropping it', async ({ page }) => {
  await open(page);
  await study(page, 'Study now');
  await page.getByRole('button', { name: /Show answer/ }).press('Enter');
  await expect(page.getByRole('button', { name: /Good/ })).toBeFocused();
  await page.getByRole('button', { name: /Again/ }).press('Enter');
  await expect(page.getByRole('button', { name: /Show answer/ })).toBeFocused();
  await page.getByRole('button', { name: /Undo last answer/ }).press('Enter');
  await expect(page.getByRole('button', { name: /Show answer/ })).toBeFocused();
});

test('an answer given just before the page is reloaded is not lost', async ({ page }) => {
  await open(page);
  await page.reload(); // now served by the service worker, so the next load is fast
  await study(page, 'Study now');
  await page.keyboard.press('Space');
  await page.keyboard.press('3');
  await page.goto('/'); // a full reload, straight after the key press
  await expect(page.getByText('1 of 20 reviews')).toBeVisible();
});

test('a second tab keeps up with the first: a card answered there leaves a session that was already open', async ({ page, context }) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  const otherCard = await study(other, 'Study now'); // both tabs now hold the same first card
  await other.keyboard.press('Space');
  await expect(otherCard).toContainText('Two colons'); // and the other one is looking at its answer
  const card = await study(page, 'Study now');
  await page.keyboard.press('Space');
  await page.keyboard.press('4'); // Easy: the card is in review, due days from now
  await expect(card).toContainText('Which key shows the answer');

  // The other tab was never reloaded or brought to the front, but must not ask for that card a second time.
  await expect(otherCard).toContainText('Which key shows the answer');
  await expect(otherCard).not.toContainText('Enter works too'); // the next card starts with its answer hidden
  await expect(other.getByText('9 to go')).toBeVisible();
  await other.keyboard.press('Escape');
  await expect(other.getByRole('heading', { level: 1 })).toHaveText('9 cards to study today');
});

test('undo takes the answer back even after the tab has reloaded its data', async ({ page }) => {
  await open(page);
  await study(page, 'Study now');
  await page.keyboard.press('Space');
  await page.keyboard.press('3');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300); // let the reload from storage finish
  await page.keyboard.press('z');
  await page.keyboard.press('Escape');
  await expect(page.getByText('0 of 20 reviews')).toBeVisible();
});

test('a cloze card hides one highlight and reveals it in place', async ({ page }) => {
  await open(page);
  const dialog = await importFiles(page, [md('cloze.md', 'Plant cells have a ==cell wall== made of ==cellulose==.')]);
  await expect(dialog.getByRole('heading')).toHaveText('2 cards in 1 note');
  await dialog.getByRole('button', { name: 'Import 2 cards' }).click();
  const card = await study(page, /^cloze/);
  await expect(card.locator('mark')).toHaveText('[…]');
  await expect(card).toContainText('Plant cells have a […] made of cellulose.');
  await page.keyboard.press('Space');
  await expect(card.locator('mark')).toHaveText('cell wall');
  await expect(card.locator('mark')).toHaveCount(1);
});

test('code and math render, and note HTML cannot run scripts', async ({ page }) => {
  await open(page);
  const note = [
    'Q: Render check',
    'A: Inline $a^2 + b^2 = c^2$ and code:',
    '```js',
    'const x = 1;',
    '```',
    '<img src="x" onerror="window.pwned = 1"><script>window.pwned = 2</script>',
    '[link](javascript:window.pwned=3)',
    'See [[Geometry|the geometry note]], ![[diagram.png]] and ![local](attachments/a.png).',
  ].join('\n');
  const dialog = await importFiles(page, [md('render.md', note)]);
  await dialog.getByRole('button', { name: /^Import/ }).click();
  const card = await study(page, /^render/);
  await page.keyboard.press('Space');
  await expect(card.locator('.katex')).toBeVisible();
  await expect(card.locator('pre .hljs-keyword')).toHaveText('const');
  await expect(card.locator('img')).not.toHaveAttribute('onerror');
  await expect(card.locator('script')).toHaveCount(0);
  await expect(card.getByText('link')).not.toHaveAttribute('href', /javascript/);
  expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
  // Obsidian links show their label; images that were not imported are named, not shown broken.
  await expect(card).toContainText('See the geometry note, [image: diagram.png] and [image: local].');
});

test('note HTML cannot draw over the app outside its card', async ({ page }) => {
  await open(page);
  const overlay = '<div class="evil" style="position:fixed;inset:0;z-index:99999;background:red">Session expired, <a href="https://example.test">sign in again</a></div>';
  const dialog = await importFiles(page, [md('overlay.md', `Overlay check :: ${overlay}`)]);
  await dialog.getByRole('button', { name: /^Import/ }).click();
  const card = await study(page, /^overlay/);
  await page.keyboard.press('Space');
  await expect(card.locator('.evil')).toBeVisible();
  await page.waitForTimeout(500); // past the answer's fade-in, which hides the problem while it runs
  const cardBox = (await card.boundingBox())!;
  const evilBox = (await card.locator('.evil').boundingBox())!;
  expect(evilBox.y).toBeGreaterThanOrEqual(cardBox.y);
  expect(evilBox.y + evilBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
  // The rating buttons below the card still take clicks.
  await page.getByRole('button', { name: /^Easy/ }).click({ timeout: 2000 });
  await expect(page.getByRole('button', { name: /^Easy/ })).toBeHidden();
});

test('a link in a note cannot take the focus meant for the rating buttons', async ({ page }) => {
  await open(page);
  // Links dressed in the app's own button classes, in the question and in the answer.
  const bait = (cls: string) => `<a class="${cls}" href="https://evil.example.test/">${cls}</a>`;
  const dialog = await importFiles(page, [md('focus.md', `Focus check ${bait('show')} :: ${bait('r3')}`)]);
  await dialog.getByRole('button', { name: /^Import/ }).click();
  await study(page, /^focus/);
  await page.getByRole('button', { name: /^Show answer/ }).click();
  await expect(page.getByRole('button', { name: /^Good/ })).toBeFocused();
});

test('the build sets a script-blocking policy, and images in notes are fetched without a referrer', async ({ page }) => {
  await open(page);
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("object-src 'none'");
  let referer: string | undefined = 'not requested';
  await page.route('https://img.example.test/**', (route) => {
    referer = route.request().headers()['referer'];
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
  });
  const dialog = await importFiles(page, [md('image.md', 'Image check :: ![pixel](https://img.example.test/p.svg)')]);
  await dialog.getByRole('button', { name: /^Import/ }).click();
  const card = await study(page, /^image/);
  await page.keyboard.press('Space');
  await expect(card.locator('img')).toBeVisible();
  expect(referer).toBeUndefined();
});

test('importing a folder builds decks from folders and tags, and skips non-notes', async ({ page }) => {
  await open(page);
  await page.getByTestId('folder').setInputFiles(VAULT);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('6 cards in 3 notes');
  await dialog.getByRole('button', { name: 'Import 6 cards' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Imported 6 cards from 3 notes.');

  const decks = page.locator('.decks li');
  await expect(decks.locator('.name')).toHaveText(['Learn recallmd in 2 minutes', 'vault', 'biology', 'cells', 'history', 'ww2']);
  await expect(page.getByRole('link', { name: /^vault/ })).toContainText('6 cards');
  await expect(page.getByText('never become a card')).toHaveCount(0);
  for (const tag of ['#bio', '#exam', '#history', '#sample']) await expect(page.getByRole('link', { name: tag, exact: true })).toBeVisible();

  await page.getByRole('link', { name: '#history' }).click();
  await expect(page.getByRole('article', { name: 'Flashcard' })).toContainText('Second World War');
  await expect(page.getByText('1 to go')).toBeVisible();
});

test('images in a folder show on the cards that link them', async ({ page }) => {
  await open(page);
  await page.getByTestId('folder').setInputFiles(IMAGES);
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('3 cards in 1 note');
  await expect(dialog.getByRole('listitem').filter({ hasText: 'image' })).toHaveText('2 images shown on the cards');
  await dialog.getByText('1 thing skipped').click();
  await expect(dialog.getByRole('listitem').filter({ hasText: 'liver' })).toHaveText('images/biology/organs.md:9: image "liver.png" not found in what you added');
  await dialog.getByRole('button', { name: 'Import 3 cards' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Imported 3 cards from 1 note and 2 images.');

  // ![[cell.png|120]] from another folder of the vault, 120px wide.
  const card = await study(page, /^images/);
  const cell = card.getByRole('img');
  await expect(cell).toHaveAttribute('width', '120');
  expect(await cell.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(80);
  await page.keyboard.press('Space');
  await page.keyboard.press('3');
  // ![alt](heart%20diagram.png) next to the note, in an answer.
  await page.keyboard.press('Space');
  const heart = card.getByRole('img', { name: 'The left ventricle' });
  await expect(heart).toBeVisible();
  expect(await heart.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
  await page.keyboard.press('3');
  // An image that was not imported is named instead.
  await page.keyboard.press('Space');
  await expect(card).toContainText('[image: liver.png]');

  // The note alone, re-imported, still finds the images stored the first time.
  await page.keyboard.press('Escape');
  dialog = await importFiles(page, [md('organs.md', await readFile(`${IMAGES}/biology/organs.md`, 'utf8'))]);
  await expect(dialog.getByText('1 thing skipped')).toBeVisible();
});

test('dropping a folder on the page imports it', async ({ page }) => {
  await open(page);
  // A real OS-level drop, so the browser hands the page directory entries to walk.
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [VAULT], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await cdp.send('Input.dispatchDragEvent', { type, x: 300, y: 300, data });
  }
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('6 cards in 3 notes');
});

test('re-importing an edited note keeps progress', async ({ page }) => {
  await open(page);
  let dialog = await importFiles(page, [md('geo.md', 'What is the capitol of France? :: Paris\nLargest ocean? :: Pacific\nLongest river? :: Nile')]);
  await dialog.getByRole('button', { name: 'Import 3 cards' }).click();

  // Study the first two cards: Easy moves them to "in review".
  await study(page, /^geo/);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Space');
    await page.keyboard.press('4');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: /^geo/ })).toContainText('1 new');

  // Fix the typo in one question, change one answer, delete one card, add one.
  dialog = await importFiles(page, [md('geo.md', 'What is the capital of France? :: Paris\nLargest ocean? :: The Pacific Ocean\nHighest mountain? :: Everest')]);
  await expect(dialog.getByRole('listitem')).toHaveText([
    '1 new',
    '1 changed',
    '1 reworded, keeps its progress',
    '1 removed, no longer in these notes',
  ]);
  await dialog.getByRole('button', { name: 'Import 3 cards' }).click();
  // Both studied cards are still studied; only the brand-new card is new.
  await expect(page.getByRole('link', { name: /^geo/ })).toContainText('1 new');
  await expect(page.getByRole('link', { name: /^geo/ })).toContainText('3 cards');

  // Emptying the note removes its cards, and with them the deck.
  dialog = await importFiles(page, [md('geo.md', 'Just prose now.')]);
  await expect(dialog.getByRole('heading')).toHaveText('No cards left in these notes');
  await dialog.getByRole('button', { name: 'Remove 3 cards' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Removed 3 cards.');
  await expect(page.getByRole('link', { name: /^geo/ })).toHaveCount(0);
});

test('pasting text, heading cards, and an import with nothing in it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Paste text' }).click();
  const paste = page.getByRole('dialog', { name: 'Paste notes' });
  await paste.getByLabel('Deck name').fill('Chemistry');
  await paste.getByLabel('Markdown').fill('## What is a mole?\n\n6.022e23 of something.\n');
  await paste.getByRole('button', { name: 'Preview cards' }).click();

  const preview = page.getByRole('dialog', { name: 'No cards found' });
  await expect(preview).toContainText('None of the 1 note contains');
  await preview.getByLabel(/turn headings into questions/).check();
  await expect(page.getByRole('dialog', { name: '1 card in 1 note' })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 card' }).click();

  await expect(await study(page, /^Chemistry/)).toContainText('What is a mole?');
});

test('a note written for the Obsidian Spaced Repetition plugin', async ({ page }) => {
  await open(page);
  const note = '#flashcards/Quiz/Geo\n\nCapital of France ::: Paris\n\nName the noble gases\nof period 2 and 3\n?\nNeon\nArgon\n<!--SR:!2026-01-01,3,250-->\n';
  const dialog = await importFiles(page, [md('obsidian.md', note)]);
  await dialog.getByRole('button', { name: 'Import 3 cards' }).click();
  // The #flashcards/… tag names the deck, not the file name.
  await expect(page.getByRole('link', { name: /^obsidian/ })).toHaveCount(0);
  const card = await study(page, /^Geo/);
  await expect(card).toContainText('Capital of France');
  await page.keyboard.press('Space');
  await expect(card).toContainText('Paris');
  await page.keyboard.press('3');
  // The reversed card asks the other way round.
  await expect(card).toContainText('Paris');
  await expect(card).not.toContainText('Capital of France');
  await page.keyboard.press('Space');
  await expect(card).toContainText('Capital of France');
  await page.keyboard.press('3');
  await expect(card).toContainText('Name the noble gases');
  await page.keyboard.press('Space');
  await expect(card).toContainText('Argon');
  await expect(card).not.toContainText('SR:');
});

test('scheduling: an Easy card leaves today and comes back when due', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 0, 10, 9, 0));
  await open(page);
  const dialog = await importFiles(page, [md('one.md', 'Only question :: Only answer')]);
  await dialog.getByRole('button', { name: /^Import/ }).click();
  await study(page, /^one/);
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Good/ })).toContainText('10m');
  const easy = await page.getByRole('button', { name: /Easy/ }).locator('.when').innerText();
  expect(easy).toMatch(/^\d+d$/);
  await page.keyboard.press('4');
  await expect(page.getByRole('heading', { name: 'Done for today' })).toBeVisible();

  // The next morning it is not due yet.
  await page.clock.setFixedTime(new Date(2026, 0, 11, 9, 0));
  await page.goto('/#/review?deck=one');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nothing is due right now' })).toBeVisible();

  // On the day FSRS scheduled, it is.
  await page.clock.setFixedTime(new Date(2026, 0, 10 + parseInt(easy), 9, 0));
  await page.reload();
  await expect(page.getByRole('article', { name: 'Flashcard' })).toContainText('Only question');
  await page.goto('/#/stats');
  await expect(page.getByText('Longest: 1')).toBeVisible();
  // The chart's numbers are also available as a table.
  await page.getByText('Show the numbers').first().click();
  await expect(page.getByRole('row', { name: 'Jan 10 1' })).toBeVisible();
});

test('export, erase and restore progress', async ({ page }) => {
  await open(page);
  await study(page, 'Study now');
  await page.keyboard.press('Space');
  await page.keyboard.press('3');
  await page.goto('/#/settings');
  await page.getByLabel('Daily goal').fill('7');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export progress' }).click();
  const file = await (await download).path();
  const backup = JSON.parse(await readFile(file, 'utf8'));
  expect(backup).toMatchObject({ app: 'recallmd', version: 1, settings: { dailyGoal: 7 } });
  expect(backup.cards).toHaveLength(14);
  expect(backup.logs).toHaveLength(1);
  expect(backup.suspended).toEqual([]);

  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await expect(page.getByRole('status')).toHaveText('Everything was erased.');
  await expect(page.getByLabel('Daily goal')).toHaveValue('20');
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No cards yet');

  await page.goto('/#/settings');
  await page.getByTestId('backup').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') });
  await expect(page.getByRole('status')).toHaveText('Import failed. This is not a recallmd backup.');

  await page.getByTestId('backup').setInputFiles(file);
  await expect(page.getByRole('status')).toHaveText('Restored 14 cards and 1 review.');
  await expect(page.getByLabel('Daily goal')).toHaveValue('7');
  await page.reload();
  await expect(page.getByLabel('Daily goal')).toHaveValue('7');
  await page.goto('/#/');
  await expect(page.getByText('1 of 7 reviews')).toBeVisible();
});

test('a save the browser refuses is reported and not passed off as done', async ({ page }) => {
  await open(page);
  // From here on every write fails, as it does when the disk is full.
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  const dialog = await importFiles(page, [md('notes.md', 'One :: 1')]);
  await dialog.getByRole('button', { name: 'Import 1 card' }).click();
  await expect(page.getByRole('alert')).toContainText('Something could not be saved: The quota has been exceeded.');
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^Imported/)).toBeHidden();
  await expect(page.getByRole('link', { name: /^notes/ })).toBeHidden();

  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('alert')).toBeHidden();
});

test('on a small phone a wide table or a long URL stays inside the card, and the buttons stay in reach', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await open(page);
  // Nothing to drag from on a phone, so the page does not ask for a drop.
  await expect(page.getByText(/Drop Markdown files/)).toBeHidden();
  await expect(page.getByText('Pick Markdown files or paste them in.')).toBeVisible();
  const table = '| Drug | Class | Mechanism of action | Half-life | Notes |\n|---|---|---|---|---|\n| Amiodarone | III | Blocks potassium channels | 58 days | Thyroid, lungs |';
  const dialog = await importFiles(page, [
    md('wide.md', `Where does https://example.com/a/really/long/url/that/does/not/break/anywhere/at/all/index.html point? :: Nowhere.\n\nQ: Which drug?\nA:\n${table}\n`),
  ]);
  await dialog.getByRole('button', { name: 'Import 2 cards' }).click();
  await study(page, /^wide/);
  // Not innerWidth: a phone zooms out to fit a page that is too wide, and innerWidth grows with it.
  const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);

  await page.getByRole('button', { name: /Show answer/ }).tap();
  expect(await pageWidth()).toBe(320);
  await page.getByRole('button', { name: /Good/ }).tap();

  await page.getByRole('button', { name: /Show answer/ }).tap();
  const cell = page.getByRole('cell', { name: 'Amiodarone' });
  await expect(cell).toBeVisible();
  expect(await pageWidth()).toBe(320);
  // The table keeps its words whole and scrolls sideways inside the card instead.
  expect(await page.locator('.md table').evaluate((t) => t.scrollWidth > t.clientWidth)).toBe(true);
  await page.getByRole('button', { name: /Good/ }).tap();
  await expect(page.getByText('2 to go')).toBeVisible(); // both come back within minutes: still in the session
  await context.close();
});

test('each page is named in the tab title and takes the focus; the skip button jumps to the content', async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle('Decks | recallmd');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Study now' })).toBeFocused();

  await page.getByRole('link', { name: 'Stats' }).click();
  await expect(page).toHaveTitle('Stats | recallmd');
  await expect(page.getByRole('main')).toBeFocused();
  await page.getByRole('link', { name: 'Decks' }).click();
  await page.getByRole('link', { name: 'Study now' }).click();
  await expect(page).toHaveTitle('Review | recallmd');
  // A rating button names its action and interval; the key is a shortcut, not part of the name.
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Good 10m', exact: true })).toHaveAttribute('aria-keyshortcuts', '3');
});

test('works offline after the first visit', async ({ page, context }) => {
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Give the worker a moment to finish caching everything it precaches.
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('10 cards to study today');

  // Lazy-loaded renderers come from the cache too: go to the math card.
  const card = await study(page, 'Study now');
  for (let i = 0; i < 12 && !(await card.getByText('Is math rendered?').isVisible()); i++) {
    await page.keyboard.press('Space');
    await page.keyboard.press('4');
  }
  await page.keyboard.press('Space');
  await expect(card.locator('.katex-display')).toBeVisible();
});
