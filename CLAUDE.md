# Sudoku

A browser-based Sudoku game built with TypeScript and esbuild, deployed to Netlify. No runtime dependencies — pure vanilla TS compiled to a single bundle.

## Architecture

The project is split into four TypeScript modules plus static HTML/CSS:

- **[src/solver.ts](src/solver.ts)** — Core types and algorithms. Exports `Board` (9×9 grid of `number | null`), `isValid`, `solve` (backtracking solver), and `countSolutions` (stops early at `max`, restores the board on return).
- **[src/generator.ts](src/generator.ts)** — Generates puzzles. Fills a board with a randomized backtracking fill, then removes cells one-by-one while verifying unique solution via `countSolutions`. Clue counts per difficulty: easy 46, normal 36, hard 28, expert 22.
- **[src/game.ts](src/game.ts)** — Pure functional game state. `GameState` holds the puzzle, solution, user board, given-cell mask, notes (bitmask per cell), notes mode, timer fields, mistake count, and undo history (`Snapshot[]`). All state mutations return a new `GameState`. Entering a correct number auto-clears that digit from peers' notes.
- **[src/main.ts](src/main.ts)** — DOM wiring. Builds the board and numpad on init, handles clicks and keyboard input (digits, Backspace/Delete/0 to erase, `N` for notes mode, arrow keys to navigate). Renders all cell classes (given, selected, peer, same-num, conflict, has-value, has-notes) and dims completed digits in the numpad. Shows a loading overlay during puzzle generation (yields to the browser with a 30ms timeout before the sync generation work).

## Build

```bash
npm run dev     # watch + dev server on dist/
npm run build   # production bundle → dist/
npm run typecheck
```

Output goes to `dist/` (bundle.js + index.html + styles.css). Netlify is configured via `netlify.toml` to run `npm run build` with Node 20 and publish `dist/`.

## Key design decisions

- **Notes as bitmask** — `notes[r][c]` is a 9-bit integer; bit `i` set means digit `i+1` is pencilled in. Toggle with XOR, clear with AND-NOT.
- **Hint cells become given** — `applyHint` marks the revealed cell as `given: true` so it becomes uneditable, matching standard Sudoku UI conventions.
- **Unique-solution guarantee** — `countSolutions(puzzle, 2)` is called after each removal during generation; cells are only removed when exactly one solution remains.
- **Undo does not re-increment mistakes** — snapshots capture `mistakes` at the time of the move, so undoing a wrong entry also restores the mistake count.

## Fonts & icons

- Raleway (700, 800) via Google Fonts
- FontAwesome (sharp/light kit `87b0bcd87f`) for toolbar icons (undo, erase, pencil, lightbulb, checkmark)

## Progress (2026-05-01)

**Completed today:**
- Reviewed cross-repo standard by auditing CLAUDE.md files for cryptogram, currency, words, number-magic, and unixtime
- Identified all infrastructure gaps relative to that standard (see Outstanding TODOs below)

**Key decisions:**
- **Setup order:** git init → GitHub repo → Netlify app (must exist before Netlify can connect); standardization tasks follow
- **Vite migration is the largest structural change** — esbuild scripts are hand-rolled and will be replaced entirely; all other standardization tasks are additive
- **TypeScript: keep** — project already uses TS; no migration needed
- **Vitest scope:** `solver.ts` and `game.ts` are pure functions with no DOM; high-value, low-effort test targets; `main.ts` DOM wiring can be deferred or tested with jsdom

**Blockers:**
- Project has no git repo yet — nothing can be pushed or connected to Netlify/GitHub until `git init` + initial commit

## Outstanding TODOs

Compared against the cross-repo standard (cryptogram, currency, words, number-magic, unixtime).

### Setup

- [ ] **Initialize git repo** — `git init`, initial commit, create GitHub repo (`craigmcn/sudoku`)
- [ ] **Create Netlify app** — connect to the GitHub repo; `netlify.toml` is already in place (`npm run build`, Node 20 → bump to 24, publish `dist/`)

### Standardization

- [ ] **Node 24** — add `.nvmrc` pinned to Node 24 LTS; update `netlify.toml` `NODE_VERSION` to match
- [ ] **Switch to Yarn 4** — replace npm + `package-lock.json` with Yarn Berry (`yarn.lock`, `.yarnrc.yml` with `nodeLinker: node-modules`); update `netlify.toml` build command to `yarn build`
- [ ] **Migrate esbuild → Vite 8** — replace the hand-rolled esbuild scripts with a `vite.config.ts`; keep `src/` layout; use `base: './'` for relative asset paths; drop the manual `cp` steps in `package.json` scripts
- [ ] **ESLint 9** — add `eslint.config.mjs` (flat config); use `neostandard` or `@typescript-eslint` recommended; `no-console: warn`; no `.eslintrc`
- [ ] **Prettier** — add `.prettierrc`; wire `yarn format`; commit `.vscode/settings.json` with `formatOnSave`
- [ ] **Vitest + tests** — solver, generator, and game logic are pure functions with no DOM dependency; target coverage for `solver.ts` (`isValid`, `solve`, `countSolutions`) and `game.ts` (state mutations, undo, notes toggle); `main.ts` can be skipped or tested with jsdom
- [ ] **Husky pre-commit hook** — run lint + `test:run` before every commit
- [ ] **CI — `.github/workflows/test.yml`** — lint → build → coverage on push to `main` and on PRs; include `corepack enable` step
- [ ] **`.github/CODEOWNERS`** — `* @craigmcn`
- [ ] **Branch protection** — require PR, 1 approval (`enforce_admins: false`), require `test` status check, dismiss stale reviews, block force push + deletion
- [ ] **README** — end-user description + developer quickstart
