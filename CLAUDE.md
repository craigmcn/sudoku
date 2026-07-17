# Sudoku

A browser-based Sudoku game built with TypeScript and Vite, deployed to Netlify. No runtime dependencies — pure vanilla TS.

## Architecture

The project is split into TypeScript modules plus static HTML/CSS:

- **[src/solver.ts](src/solver.ts)** — Core types and algorithms. Exports `Board` (9×9 grid of `number | null`), `isValid`, `solve` (backtracking solver), and `countSolutions` (stops early at `max`, restores the board on return).
- **[src/rng.ts](src/rng.ts)** — `mulberry32(seed)`, a small seedable PRNG returning a `Math.random`-compatible `() => number` in `[0, 1)`. Exists so puzzle generation can be made reproducible from a seed (daily puzzles, puzzle-ID hashing) without pulling in a larger dependency.
- **[src/puzzleId.ts](src/puzzleId.ts)** — `hashSolution(board)`, a stable content-hash ID for a solved grid (two 32-bit FNV-1a passes, concatenated as base36). Used to key puzzle documents so two independently-generated puzzles with the same solution collapse onto the same ID/stats instead of duplicating.
- **[src/generator.ts](src/generator.ts)** — Generates puzzles. Fills a board with a randomized backtracking fill, then removes cells one-by-one while verifying unique solution via `countSolutions`. Clue counts per difficulty: easy 46, normal 36, hard 28, expert 22. `generatePuzzle(difficulty, seed?)` — an optional numeric `seed` makes the whole generation (fill order and removal order) deterministic via `mulberry32`; omitting it falls back to `Math.random` as before.
- **[src/game.ts](src/game.ts)** — Pure functional game state. `GameState` holds the puzzle, solution, user board, given-cell mask, notes (bitmask per cell), notes mode, timer fields, mistake count, and undo history (`Snapshot[]`). All state mutations return a new `GameState`. Entering a correct number auto-clears that digit from peers' notes.
- **[src/main.ts](src/main.ts)** — DOM wiring. Builds the board and numpad on init, handles clicks and keyboard input (digits, Backspace/Delete/0 to erase, `N` for notes mode, arrow keys to navigate). Renders all cell classes (given, selected, peer, same-num, conflict, has-value, has-notes) and dims completed digits in the numpad. Shows a loading overlay during puzzle generation (yields to the browser with a 30ms timeout before the sync generation work).

## Build

```bash
yarn dev           # dev server at http://localhost:3110
yarn build         # production build → dist/
yarn preview       # preview production build
yarn typecheck
yarn lint
yarn test:run
yarn test:e2e      # Playwright, starts its own dev server
```

## Key design decisions

- **Notes as bitmask** — `notes[r][c]` is a 9-bit integer; bit `i` set means digit `i+1` is pencilled in. Toggle with XOR, clear with AND-NOT.
- **Hint cells become given** — `applyHint` marks the revealed cell as `given: true` so it becomes uneditable, matching standard Sudoku UI conventions.
- **Unique-solution guarantee** — `countSolutions(puzzle, 2)` is called after each removal during generation; cells are only removed when exactly one solution remains.
- **Undo does not re-increment mistakes** — snapshots capture `mistakes` at the time of the move, so undoing a wrong entry also restores the mistake count.
- **Solver tests cover `isValid` only** — `solve` and `countSolutions` are backtracking algorithms that are too slow to run against constrained boards in unit tests.
- **`getPeerCoords` deduplicates row/col/box** — box loop uses `r !== row && c !== col` to avoid duplicating cells already covered by the row and column sweeps (20 peers, not 24).
- **Yarn 4 standalone project** — an empty `yarn.lock` at the project root is required because `~/package.json` exists with a `packageManager` field; without it Yarn treats the project as a sub-workspace.

## Fonts & icons

- Outfit (via albertcss v0.18.0, `albert.min.css`) — albertcss switched Raleway → Outfit in v0.17.0; delegated entirely to the CDN link, no font override in `styles.css`
- FontAwesome (sharp/light kit `87b0bcd87f`) for toolbar icons (undo, erase, pencil, lightbulb, checkmark)

## Progress (2026-05-02)

**Completed:**

- git init, initial commit, GitHub repo (`craigmcn/sudoku`), Netlify app
- Node 24 (`.nvmrc`)
- Yarn 4 (`.yarnrc.yml`, `nodeLinker: node-modules`, empty `yarn.lock` to declare standalone project)
- Vite 8 migration (`vite.config.ts`, `index.html` at root, `public/styles.css` served via Vite publicDir)
- `build:netlify` script + `vite.config.netlify.ts` (outputs to `netlify/` and `netlify/sudoku/`)
- ESLint 9 (`eslint.config.mjs`, `@typescript-eslint`, `no-console: warn`, `eslint-config-prettier`)
- Prettier (`.prettierrc` with `endOfLine: lf`, `yarn format`, `.vscode/settings.json` with `formatOnSave`)
- `.editorconfig` (utf-8, LF, 2-space indent, final newline — consistent with Prettier)
- Vitest + tests (35 tests, ~190ms): `src/solver.test.ts` covers `isValid`; `src/game.test.ts` covers all state mutations plus extracted helpers
- game.ts refactor: extracted `getPeerCoords`, `toggleNote`, `erasePeerNotes` (exported, tested); `takeSnapshot` (unexported, removes duplication); `enterNumber` and `getConflicts` simplified
- Husky pre-commit hook (`yarn lint && yarn test:run`)
- CI (`.github/workflows/test.yml`: lint → build → test:coverage on push/PR)
- CODEOWNERS (`.github/CODEOWNERS`: `* @craigmcn`)
- README
- Branch protection on `main`: PR required, 1 approval, dismiss stale reviews, require code owner review, `test` status check required, no force-push/deletion, `enforce_admins: false`
- albertcss v0.15.0 integration: CDN `<link>` in `index.html`; `public/styles.css` stripped to game-only declarations (~85 lines removed)

**Key decisions — albertcss integration:**

- **CDN `<link>` over vendoring** — consistent with existing Google Fonts / FontAwesome CDN pattern; albertcss is the author's own library so the CDN is authoritative
- **`--ab-*` prefix dropped** — game tokens now reference albertcss vars directly (e.g. `var(--primary)`, `var(--grey900)`); dark mode colour flipping is fully delegated to albertcss
- **`.header` renamed to `.game-header`** — avoids collision with albertcss's `.header` component (site nav grid), keeping both stylesheets independent
- ~~Raleway font-weight reduced to 600~~ — superseded; albertcss switched to Outfit in v0.17.0 (weights 500/600, no override needed here)

**Outstanding:**

- None — SRI resolved 2026-07-11: bumped to albertcss v0.18.0, switched the `<link>` to `albert.min.css`, added `integrity`/`crossorigin` using the hash published in albertcss's `versions.json`.

**Future TODOs:** tracked as issues in the [sudoku GitHub Project](https://github.com/users/craigmcn/projects/10) — Firebase login + per-user stats, and anonymous game identity/puzzle numbering.

- **Storage backend research done (2026-07-11)** — Firebase (Firestore + Auth) is the recommended free backend for puzzle-by-number storage, "puzzle of the day," and the login TODOs above; compared against Supabase, Netlify Blobs, MongoDB Atlas, and Cloudflare D1. Reuse the `files` repo's Firestore-doc-per-user pattern, but create the user doc client-side on first sign-in rather than via a `beforeUserCreated` Cloud Function trigger (that requires the paid Blaze plan). Proposed collections: `puzzles/{puzzleNumber}`, `dailyPuzzle/current`, `users/{uid}.progress`. Puzzle numbering doesn't exist yet — `generator.ts` uses raw `Math.random()` with no seed — so a numbering scheme is part of implementation, not already solved. Full writeup saved locally in Claude Code plan history (`research-free-database-or-quizzical-neumann`).

## Pause timer (2026-07-11)

- **`started`/`paused` on `GameState`** — the timer doesn't run until the player enters their first digit (`started` flips `true` inside `enterNumber`, only for an actual value, not a pencil note). Every state-mutating action in `game.ts` (`selectCell`, `enterNumber`, `eraseCell`, `undoMove`, `toggleNotesMode`, `applyHint`) no-ops while `paused`, so the pause guarantee holds even if a UI guard is missed.
- **`pauseGame`/`resumeGame`/`togglePause`** — `resumeGame` re-anchors `startTime` to `Date.now() - elapsed * 1000` so the displayed time picks up where it left off rather than including the paused interval.
- **Pause overlay reuses the existing `.overlay`/`.modal` pattern** — same blurred full-screen treatment as the loading/victory overlays, which also has the side effect of blocking board interaction while paused (no extra click-blocking CSS needed). `P` is a keyboard shortcut for pause/resume.

## Playwright e2e tests (2026-07-11)

- **[e2e/sudoku.spec.ts](e2e/sudoku.spec.ts)** — same pilot pattern rolled out from `wordle-helper`: `playwright.config.ts` at the root (`testDir: ./e2e`, `webServer` runs `yarn dev` against port 3110), `test:e2e` script, CI step after `test:coverage` with a cached browser install, `e2e/` excluded from Vitest's glob and covered by `yarn lint`. Not in the pre-commit hook (browser install/startup too slow for a hook), matching the cross-repo rollout plan.
- **Clue counts aren't asserted exactly** — `generatePuzzle` in `generator.ts` stops removing cells early if uniqueness would break, so the actual given-cell count can exceed the `CLUE_COUNTS` target. Tests assert relative counts (expert < easy) instead of the exact 46/36/28/22 figures.
- **Locators re-evaluate on every action** — `.cell:not(.given)` is a live selector; once a hint reveals a cell it gains `.given` and drops out of that locator, silently shifting `.first()`/`.nth()` to a different cell on the next call. Tests that pick a cell and then act on it snapshot `data-row`/`data-col` first, then re-locate by those attributes for follow-up assertions.
- **Wait for `#loading` to be hidden before reading board state** — puzzle generation is async (a 30ms yield plus the actual backtracking work), so a bare `locator.count()` read right after `page.goto()` or a difficulty click can race it and undercount `.cell.given`. Every test that reads board state first asserts `#loading` has the `hidden` class.
- **Pause overlay blocks clicks at the browser level, not just in app state** — Playwright's own actionability check refuses to click the numpad through `#pauseOverlay` (`intercepts pointer events`), which is confirmation the CSS-only blocking approach (documented under Pause timer above) works. The pause test uses `{ force: true }` to bypass that check and additionally confirm `game.ts`'s `paused` guard makes the input a no-op even if the overlay were somehow bypassed.

## Firebase puzzle-data planning (2026-07-17)

**Completed:**

- Planned the Firebase backend groundwork for Issue #12 (login + per-user stats), split into discrete issues on the [sudoku GitHub Project](https://github.com/users/craigmcn/projects/10):
  - **#13** (updated, now the umbrella/context issue) — problem statement, data model summary, links to the issues below
  - **#15** — seeded PRNG for `generator.ts` + canonical puzzle-ID (content hash of the solved grid) — **implemented**: [src/rng.ts](src/rng.ts) (`mulberry32`), [src/puzzleId.ts](src/puzzleId.ts) (`hashSolution`), `generatePuzzle(difficulty, seed?)` in [src/generator.ts](src/generator.ts); tests in `rng.test.ts`, `puzzleId.test.ts`, `generator.test.ts`
  - **#16** — Firebase project + Firestore client setup (`src/firebase.ts`, env vars, security rules, `puzzles`/`dailyPuzzles` collections)
  - **#17** — anonymous play identity (`signInAnonymously`) + play-stats tracking (times played, time played, completions)
  - **#18** — daily puzzle: one deterministic puzzle per difficulty per date, plus a shared "daily random" pick from easy/normal/hard

**Key decisions:**

- **Puzzle ID = content hash of the solved grid, not a sequential counter** — generation is client-side and random (`Math.random()` today), so there's no central sequencer. Hashing the solution means two independently-generated identical puzzles collapse to the same Firestore doc/stats automatically, which is what "we already generated this exact puzzle" requires.
- **Seeded PRNG is the prerequisite for everything else (#15 first)** — both daily puzzles (deterministic seed → same puzzle every time) and dedup/stats (stable ID from a reproducible generation) depend on replacing raw `Math.random()` with a seedable generator. `generatePuzzle(difficulty, seed?)` keeps `seed` optional so existing random-puzzle callers are unaffected.
- **Anonymous auth (`signInAnonymously`) before real login** — split into its own issue (#17) rather than bundled with #12, so play stats have a stable uid to attach to immediately, and can be merged into a real account once #12's login lands, rather than waiting on login to exist first.
- **Client-side doc creation, not a `beforeUserCreated` trigger** — mirrors the `files` repo's Firestore-doc-per-user pattern but avoids the paid Blaze plan requirement, consistent with the storage-backend research already on file (see "Storage backend research done" note above).
- **Display-facing puzzle numbering is explicitly deferred** — the content hash is sufficient for dedup/stats; a separate human-facing sequence number (if wanted) can be layered on later without touching the identity scheme.

**Outstanding / next:**

- #15 done; next up is #16 (Firebase project + Firestore client setup), then #17/#18 in parallel.
- No open questions blocking #16.

## mise + Node 24 CI (2026-07-11)

- **`.nvmrc` → `.node-version`** — project now uses `mise` locally, which reads `.node-version` (no `v` prefix, e.g. `24.14.1`) rather than `.nvmrc`. CI's `setup-node` step points at `node-version-file: .node-version`.
- **`actions/checkout` → v7, `actions/setup-node` → v6, `actions/cache` → v6** — resolves GitHub's "Node.js 20 actions are deprecated" warning; all three majors now run on the Node 24 Actions runtime.
