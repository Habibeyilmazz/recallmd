# Contributing

Thanks for looking. The project is small on purpose: Vite, React and TypeScript, no backend, few dependencies.

## Setup

Node.js 22.12 or newer.

```sh
npm install
npm run dev          # http://localhost:4130
npm run typecheck
npm test             # Vitest unit tests
npm run build
npm run e2e          # Playwright against the build; run npm run build first
```

The end-to-end tests need Chromium once: `npx playwright install chromium`.

## Before you open a pull request

- Open an issue first for anything bigger than a bug fix, so we can agree it fits.
- Logic changes come with a test. The parser, importer, scheduler and stats are pure functions in `src/lib/` with tests beside them; start there.
- Keep it small: no new dependency for a few lines, no abstraction for a second use that does not exist yet.
- `npm run typecheck`, `npm test` and `npm run build` pass. CI runs them plus the e2e tests.
- Keep the README and CHANGELOG honest: describe what exists and works, under "Unreleased".
- Use only synthetic notes in tests, fixtures and bug reports. Do not paste private notes.

## Screenshots and the demo clip

`scripts/screenshots.mjs` and `scripts/demo.mjs` regenerate `docs/` from the running production build (`npm run preview`). The demo needs `ffmpeg`.

## License

By contributing you agree your work is released under the [MIT license](LICENSE).
