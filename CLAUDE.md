# Sudoku

A browser-based Sudoku game built with TypeScript and Vite, deployed to Netlify. No runtime dependencies — pure vanilla TS.

## Architecture

The project is split into four TypeScript modules plus static HTML/CSS:

- **[src/solver.ts](src/solver.ts)** — Core types and algorithms. Exports `Board` (9×9 grid of `number | null`), `isValid`, `solve` (backtracking solver), and `countSolutions` (stops early at `max`, restores the board on return).
- **[src/generator.ts](src/generator.ts)** — Generates puzzles. Fills a board with a randomized backtracking fill, then removes cells one-by-one while verifying unique solution via `countSolutions`. Clue counts per difficulty: easy 46, normal 36, hard 28, expert 22.
- **[src/game.ts](src/game.ts)** — Pure functional game state. `GameState` holds the puzzle, solution, user board, given-cell mask, notes (bitmask per cell), notes mode, timer fields, mistake count, and undo history (`Snapshot[]`). All state mutations return a new `GameState`. Entering a correct number auto-clears that digit from peers' notes.
- **[src/main.ts](src/main.ts)** — DOM wiring. Builds the board and numpad on init, handles clicks and keyboard input (digits, Backspace/Delete/0 to erase, `N` for notes mode, arrow keys to navigate). Renders all cell classes (given, selected, peer, same-num, conflict, has-value, has-notes) and dims completed digits in the numpad. Shows a loading overlay during puzzle generation (yields to the browser with a 30ms timeout before the sync generation work).

## Build

```bash
yarn dev           # dev server at http://localhost:3070
yarn build         # production build → dist/
yarn preview       # preview production build
yarn typecheck
yarn lint
yarn test:run
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

- Raleway (700, 800) via Google Fonts
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

**Outstanding:**
- Netlify config — `netlify.toml` lives in `craigmcnaughton` repo; needs `yarn build:netlify` as build command and updated publish dir (`netlify/sudoku`)
