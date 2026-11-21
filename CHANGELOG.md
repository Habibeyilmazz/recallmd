# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Changes from an independent first-run review: a fresh clone, the README quickstart followed literally, and a read of the whole codebase.

### Fixed

- A setext heading underline (`=====`) or a row of equals signs was read as a `==highlight==` and became a cloze card hiding a single `=`.
- Two tabs open at once could schedule a card from a state the other tab had already replaced. Every write is now announced on a `BroadcastChannel` and the other tabs reload their data.
- Undo left the answer in the day's review count if the tab had reloaded its data since the answer was given.
- "1 reviews" in the export and restore messages.

### Changed

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
- Tabs stay in sync through `onChangeElsewhere` in `db.ts` (a `BroadcastChannel` message after every committed write) and a reload in `store.ts`. What is left: a review session's queue is fixed when it starts, and a reload that lands within a few milliseconds of a local answer can show stale numbers until the next reload (storage is always right). Both are too unlikely for one person to justify more code.
- The `overrides` entry for `glob` in `package.json` exists only to clear `npm audit`. Remove it once `workbox-build` depends on glob 14.0.2 or newer by itself; after touching it, check that `npm run build` still reports 37 precache entries and that the offline end-to-end test passes.
- `db.ts` calls `tx.commit()` on purpose: without it an answer given just before a reload was lost. `e2e/app.spec.ts` has the regression test.
- The Content-Security-Policy is injected by a small plugin in `vite.config.ts`, for builds only.
- Screenshots: `npm run build && npm run preview`, then `node scripts/screenshots.mjs`. Icons: `node scripts/make-icons.mjs` after editing `public/icon.svg`.
- GitHub Pages is not enabled. The deploy workflow only runs from the Actions tab.
- Not done yet: see the Roadmap in the README.
