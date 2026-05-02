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

## Fonts & icons

- Raleway (700, 800) via Google Fonts
- FontAwesome (sharp/light kit `87b0bcd87f`) for toolbar icons (undo, erase, pencil, lightbulb, checkmark)

## Progress (2026-05-02)

**Completed:**
- git init, initial commit, GitHub repo (`craigmcn/sudoku`), Netlify app
- Node 24 (`.nvmrc`)
- Yarn 4 (`.yarnrc.yml`, `nodeLinker: node-modules`, empty `yarn.lock` to declare standalone project)
- Vite 8 migration (`vite.config.ts`, `index.html` at root, `public/styles.css` served via Vite publicDir)
- ESLint 9 (`eslint.config.mjs`, `@typescript-eslint`, `no-console: warn`, `eslint-config-prettier`)
- Prettier (`.prettierrc`, `yarn format`, `.vscode/settings.json` with `formatOnSave`)
- Vitest + tests (`src/solver.test.ts` for `isValid`, `src/game.test.ts` for all game state mutations)
- Husky pre-commit hook (`yarn lint && yarn test:run`)
- CI (`.github/workflows/test.yml`: lint → build → test:coverage on push/PR)
- CODEOWNERS (`.github/CODEOWNERS`)
- README

**Deferred:**
- Branch protection — set via GitHub UI
- Netlify config (`netlify.toml` lives in `craigmcnaughton` repo, update pending)
