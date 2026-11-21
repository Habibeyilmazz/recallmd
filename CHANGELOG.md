# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A Cards page (`#/cards`, in the header): search every card by words from its question, answer, deck, note path or `#tag`, filter to due today, new or suspended, and see each card's status ("Due in 4d"). It lists the first 100 matches.
- Suspending cards. Suspend or unsuspend from the Cards page, or press `S` (or "Suspend card") during a review; `Z` takes a suspend back like an answer. A suspended card keeps its progress, is left out of reviews, deck counts and the forecast, and stays suspended across re-imports. Stats shows how many are suspended, linking to them. Backups carry a `suspended` list; backups without one still load.

### Fixed

- Reliability pass (fuzzed the parser with 40,000 random notes, ran the unit tests in five time zones, and timed big imports; the parser and time handling held up). A note rewritten wholesale froze the tab while progress was matched to reworded questions: 3000 reworded cards took 2.7 s, 3000 with the same answer 36 s. Candidates are now grouped by answer and comparisons are capped at 200,000 (a warning says how many reviewed cards were not matched; their progress is kept). Unit tests time both cases.
- A deck name with an empty or blank part (`a//b` in a path, `deck:` front matter or the paste dialog) made a nameless row on the Decks page. Such parts are now dropped.
- Checked and not a bug: the Cards page shows each card as one plain line on purpose, and the first-run sample import is idempotent when two tabs open at once. Firefox and Safari remain untested.

### Changed

- Below 26rem the header shows the app icon without its name, so the four links fit down to 320px.

Earlier in this release:

Four rounds of changes. The fourth was a security pass (see "Security" below). The first was an independent first-run review: a fresh clone, the README quickstart followed literally, and a read of the whole codebase. The second was a design and accessibility pass: every screen looked at in screenshots of the running app at 1180px, 390px and 320px, light and dark, and walked with the keyboard. The third was a second design pass that re-shot every screen and state (done, empty, dialogs) and found the two issues listed first under Fixed; README screenshots were regenerated and showed no visible change, so they were left as they were.

### Security

- A note could carry HTML with inline styles (`position: fixed`) and draw a fake screen, a phishing link for example, over the whole app. Rendered Markdown is now `contain: paint`, so nothing in a note reaches outside its card. End-to-end test: "note HTML cannot draw over the app outside its card".
- Images linked from notes were requested with the app's origin as `Referer`. The page now sets `<meta name="referrer" content="no-referrer">`. The same new end-to-end test also checks that the production build carries the Content-Security-Policy, which had no test before.
- A note could hang or crash the tab: a line of unclosed `<!--` took minutes to import, a line of unclosed `![[a|` took seconds per card to render, and a long paragraph full of `==highlights==` needed gigabytes of card text (out of memory). Comments are now removed with a linear loop, wikilink names are limited to 500 characters, and a paragraph whose cloze cards would hold more than 2 million characters in all is skipped with a warning. Unit tests time each case.
- GitHub Actions are pinned to full commit SHAs (version in a comment) and `actions/checkout` no longer leaves the token in the checkout.

### Added

- A "Skip to content" button, a tab title per page ("Stats | recallmd"), and focus that moves to the page when the route changes.
- Empty states that say what to do: the Decks page with no cards points to "Add notes" and to the sample deck in Settings, and a chart with nothing in it says why instead of drawing an empty axis.
- Key hints under the review buttons (`Space` Good, `Esc` Back to decks, `Z` Undo), hidden where there is no keyboard.

### Fixed

- Pressing "Show answer", a rating or "Undo last answer" with the keyboard removed the focused button and dropped the focus to the page body, so a screen reader lost its place. The button that takes its place (Good, Show answer, or Back to decks when the session ends) now gets the focus.
- On a touch screen the add-notes box asked you to drop files on the page; it now says to pick files or paste them in.
- Importing notes, removing a deck, erasing everything and adding the sample deck ignored a write that the browser refused (a full disk, for example): nothing changed and nothing was said. They now show the same "Something could not be saved" message as a failed answer, and that message stays in view while the page scrolls.
- A card with a wide table or a long URL widened the whole page on a phone. Long words now break and a table scrolls sideways inside the card.
- A card answered in one tab could come up again in a review session that was already open in another tab.
- On the Decks page the "new" and "cards" counts sat a few pixels above the deck name and did not line up down the list.
- The edges of text fields were 1.3:1 against the page and are now above 3:1. Placeholder text in the paste dialog was 3.4:1 on the dark theme. The progress bar's yellow fill had no visible edge on the light theme.
- Rating buttons were announced as "Good 10m 3": the key is now a shortcut (`aria-keyshortcuts`) and not part of the name.
- A setext heading underline (`=====`) or a row of equals signs was read as a `==highlight==` and became a cloze card hiding a single `=`.
- Two tabs open at once could schedule a card from a state the other tab had already replaced. Every write is now announced on a `BroadcastChannel` and the other tabs reload their data.
- Undo left the answer in the day's review count if the tab had reloaded its data since the answer was given.
- "1 reviews" in the export and restore messages.

### Changed

- Review: the answer buttons stay at the bottom of the window whatever the card's length, and on a phone the card fills the screen above them. "Show answer" and the four ratings share one height, so nothing below them moves when the answer appears. The ratings are tinted by meaning. The answer fades in (not with reduced motion).
- Decks: folders are bold and the decks inside them are not. On touch screens every control is at least 44px tall and tags are chips.
- Stats: "No data yet" is no longer set as large as a number, and "Longest" names its unit.
- The screen shown when the browser blocks storage explains what happened and offers a retry.
- Bars and the highlighter keep their meaning in forced-colours (Windows High Contrast) mode.
- README screenshots retaken from the new build.
- The paste dialog says plainly that pasting under a deck name you already used replaces that deck.
- README: the required Node version is 22.12 or newer (Vitest 5 does not run on Node 20), and dropping files works on the Decks page, not on every page. `package.json` has a matching `engines` field.
- `npm install` no longer reports audit warnings: an `overrides` entry moves `workbox-build`'s `glob` to a patched release.

## [0.1.0] - 2026-11-21

First release.

### Added

- Markdown parser for four card syntaxes: `Question :: Answer` lines, `Q:`/`A:` blocks, `==cloze==` deletions, and optional heading-as-question. Front matter `deck:` and `tags:`, inline `#tags`.
- Import from dropped files or folders, the file and folder pickers, or pasted text, with a preview of what changes.
- Stable card identity (hash of kind + normalized question) and progress carry-over to reworded questions on re-import.
- FSRS scheduling through ts-fsrs, a daily queue with learning steps, a new-cards-per-day limit and undo.
- Keyboard-first review screen with rendered Markdown, highlighted code and KaTeX math.
- Decks from folders and front matter, study by tag, daily goal, streak, retention, review history and due forecast.
- IndexedDB storage, JSON export and import of everything, erase-all.
- Offline PWA (service worker precache, manifest, icons), light and dark themes.
- Built-in sample deck on first run.
- Unit tests (Vitest) and end-to-end tests (Playwright), CI, and a manual-only GitHub Pages deploy workflow.

### Notes for whoever works on this next

- Commands: `npm run dev` (port 4130), `npm run typecheck`, `npm test`, `npm run build`, `npm run preview` (port 4131), `npm run e2e` (needs a build first).
- All logic lives in `src/lib/` as pure functions with tests next to them; `src/views/` is thin. Start with `parser.ts` and `scheduler.ts`.
- `Card.seq` exists because IndexedDB returns cards in id order; `byNote` restores note order after loading.
- Tabs stay in sync through `onChangeElsewhere` in `db.ts` (a `BroadcastChannel` message after every committed write) and a reload in `store.ts`; an open review session drops cards answered elsewhere through `syncQueue` in `scheduler.ts`. What is left: cards that became due or were imported after a session started join it only when it is started again, and a reload that lands within a few milliseconds of a local answer can show stale numbers until the next reload (storage is always right).
- `store.importNotes`, `deleteCards` and `replaceAll` never reject: they resolve to `false` after reporting the failure, so a caller only has to skip its success message.
- Design: one stylesheet, `src/styles.css`, no component library. The idea is cool paper, blue-black ink and one yellow highlighter; the highlighter marks the current page, the primary action, progress and what is due, and nothing else. Colours are custom properties at the top of the file, with the dark theme right under them. Touch rules are under `@media (pointer: coarse)`, phone layout under `(max-width: 30rem)`.
- How the design pass was checked, for anyone repeating it: Playwright scripts (not kept) drove the dev server through every state at 1180, 390 and 320px in both themes, computed the contrast of every text node against its background, measured every control, and pressed Tab through the pages. No text was under 4.5:1, nothing overflowed sideways, and no touch target was under 44px except the checkbox inside its label. Not checked: Firefox, Safari, a real screen reader, a real phone.
- When measuring sideways overflow under Playwright's `isMobile`, compare `scrollWidth` with the device width, not `innerWidth`: a phone zooms out to fit a page that is too wide and `innerWidth` grows with it. `e2e/app.spec.ts` has the test.
- `scripts/screenshots.mjs` runs with reduced motion so it cannot catch the answer halfway through fading in.
- The `overrides` entry for `glob` in `package.json` exists only to clear `npm audit`. Remove it once `workbox-build` depends on glob 14.0.2 or newer by itself; after touching it, check that `npm run build` still reports 37 precache entries and that the offline end-to-end test passes.
- `db.ts` calls `tx.commit()` on purpose: without it an answer given just before a reload was lost. `e2e/app.spec.ts` has the regression test.
- The Content-Security-Policy is injected by a small plugin in `vite.config.ts`, for builds only.
- Screenshots: `npm run build && npm run preview`, then `node scripts/screenshots.mjs`. Icons: `node scripts/make-icons.mjs` after editing `public/icon.svg`.
- GitHub Pages is not enabled. The deploy workflow only runs from the Actions tab.
- Security pass (round four), what was checked and found fine: DOMPurify blocks `javascript:` links, event handlers and scripts (e2e test); KaTeX runs with `trust: false` and its default `maxExpand`; backup import validates every field and caps files at 100 MB; dropped folders skip dot-folders and cap file size and count; `npm audit` reports nothing; no secrets in git history; both workflows have `contents: read` at the top and only the deploy job gets `pages: write`. Not fixed: marked itself is slow on a very long line of `_a_a_a…` (about 1.4 s for 40 KB), which is upstream.
- The action SHAs in `.github/workflows/` were looked up with `gh api repos/<owner>/<action>/commits/<tag>`; update them the same way.
- Suspension (feature round): `AppData.suspended` is a `Set` of card ids, stored whole under the `kv` key `suspended` by `db.saveSuspended`. It is never pruned, on purpose: like progress, it must survive removing and re-importing a note. Filtering happens at the callers (App for review, Home for the queue, Stats for the forecast); `countCards`/`deckRows` take the set and count suspended cards only in `total`. `store.suspend` updates memory first and reloads from storage if the write fails. Gaps the previous round listed were rechecked and are not bugs: marked's slowness is upstream, remote images loading from their server is documented under Limits, and Pages, Node 20 and other browsers are out of reach here.
- Not done yet: see the Roadmap in the README.
