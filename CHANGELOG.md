# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

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
- A second-opinion review (Codex) found eleven issues before release; all were fixed except true multi-tab safety, which is mitigated (a tab reloads its data when it becomes visible) and listed under Limits in the README. Doing it properly means reading, scheduling and writing inside one IndexedDB transaction.
- `db.ts` calls `tx.commit()` on purpose: without it an answer given just before a reload was lost. `e2e/app.spec.ts` has the regression test.
- The Content-Security-Policy is injected by a small plugin in `vite.config.ts`, for builds only.
- Screenshots: `npm run build && npm run preview`, then `node scripts/screenshots.mjs`. Icons: `node scripts/make-icons.mjs` after editing `public/icon.svg`.
- GitHub Pages is not enabled. The deploy workflow only runs from the Actions tab.
- Not done yet: see the Roadmap in the README.
