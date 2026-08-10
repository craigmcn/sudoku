# Onboarding Guide

Welcome! This document explains how the Sudoku codebase works, in plain English, for
developers who are new to the project (or new-ish to web development in general). It
complements [CLAUDE.md](../CLAUDE.md), which is a terse, current-state reference — this
doc is the guided tour that gets you to the point where CLAUDE.md makes sense at a glance.

If you just want the "what does each file do" cheat sheet, CLAUDE.md's Architecture
section already has that. This doc instead answers: *why is the code shaped this way,
and how do the pieces fit together when someone actually plays the game?*

---

## 1. What this app actually is

A single-page Sudoku game that runs entirely in the browser. There's no backend server —
just static files (HTML/CSS/JS) hosted on Netlify and GitHub Pages. The only network
calls this app makes are to **Firebase** (Google's app-backend-as-a-service), and only
for optional extras: signing in, and remembering your stats (times, completions). If
Firebase is unreachable or unconfigured, the game still works perfectly — you just don't
get saved stats. That's a deliberate design choice you'll see repeated everywhere in the
code (more on this in section 5).

**No React, no Vue, no framework at all.** The UI is built with plain TypeScript that
directly creates and updates DOM elements. If you're used to React, this will feel
old-school at first, but it's a small enough app that it stays manageable. There's no
virtual DOM, no component tree — `main.ts` just queries the DOM (`document.querySelector`
etc.) and mutates it directly whenever the game state changes.

---

## 2. The three-layer mental model

The easiest way to understand this codebase is to think of it in three layers, and to
notice that **data flows in one direction** through them:

```
solver.ts / generator.ts / rng.ts   →   game.ts   →   main.ts
      (how Sudoku works)              (game rules)      (what you see)
```

1. **Sudoku mechanics** (`solver.ts`, `generator.ts`, `rng.ts`, `puzzleId.ts`) — pure
   math/logic with zero knowledge of "the game" or "the screen." These functions know
   what a valid Sudoku board looks like and how to build one. They don't know about
   clicking, timers, or pausing.

2. **Game state** (`game.ts`) — the rules of *playing* a puzzle: selecting a cell,
   typing a number, pencilling in notes, undoing a move, pausing the timer. This layer
   knows nothing about HTML — it just transforms one `GameState` object into a new one.

3. **UI wiring** (`main.ts`) — the only file that touches the DOM. It listens for
   clicks/keypresses, calls functions from `game.ts` to compute the next state, then
   re-renders the board to match. It's the "controller" that glues the pure logic to the
   actual page.

Everything downstream from `main.ts` (Firebase calls, localStorage) is "best effort" —
those are extras layered on top, never something the core game depends on to function.

Keep this diagram in your head as you read code: if you're in `solver.ts` and find
yourself wanting to know "what does the pause button do," you're in the wrong file —
that's a `main.ts` concern. If you're in `game.ts` and want to know "how do I remove
cells to make a puzzle," that's `generator.ts`'s job, not `game.ts`'s.

---

## 3. Sudoku mechanics: how a puzzle is built and solved

### `solver.ts` — the foundation everything else builds on

Three exported functions:

- **`isValid(board, row, col, num)`** — "if I put `num` at `(row, col)`, does that
  break any Sudoku rule?" Checks the row, the column, and the 3×3 box the cell belongs
  to. This is the single rule-checking primitive every other function relies on.

- **`solve(board)`** — a classic **backtracking** solver. It scans for the first empty
  cell, tries digits 1–9 in it, and recurses. If a digit leads to a dead end further
  down the board, it "backtracks" (undoes that digit) and tries the next one. This is
  the same algorithm you'd write to solve any constraint puzzle — worth understanding
  even outside Sudoku, since backtracking shows up constantly in coding interviews and
  real scheduling/routing problems.

- **`countSolutions(board, max = 2)`** — same idea as `solve`, but instead of stopping
  at the first solution it counts them, up to a cap (`max`). Why cap it? Because for
  puzzle generation we only care about the difference between "exactly one solution"
  (a valid puzzle) and "more than one" (ambiguous, not a real puzzle) — we don't need to
  know if there are 2 or 200,000 solutions, so stopping early saves a huge amount of
  work. Note: it restores the board to its original state before returning, so callers
  can reuse the same board object afterward.

**Board shape**: a `Board` is just `(number | null)[][]` — a 9×9 array of arrays, where
`null` means "empty cell." No custom classes, no wrapper objects. This simplicity is
intentional and makes the solver/generator code easy to reason about.

### `rng.ts` — reproducible randomness

`mulberry32(seed)` is a small "seedable" random number generator. Normally
`Math.random()` gives you different numbers every time you run your program — great for
unpredictability, useless if you want the *same* "random" puzzle twice. `mulberry32`
takes a seed number and returns a function that behaves like `Math.random()` (numbers
between 0 and 1) but is fully deterministic: same seed in, same sequence of "random"
numbers out, every time, on every machine.

Why does that matter here? **Daily puzzles.** Everyone playing "today's puzzle" needs to
get the exact same board, without a server handing it out — so the seed is derived from
today's date (see `dailyPuzzle.ts`), and every browser independently generates the
identical puzzle from that seed.

### `generator.ts` — building a puzzle from nothing

Puzzle generation happens in two steps:

1. **Fill the board completely** using a randomized version of the same backtracking
   idea from `solver.ts` — but shuffle the digit order at each cell so you get a
   different valid, fully-solved 9×9 grid each time (or a reproducible one, if a seed
   was passed in).

2. **Remove cells one at a time**, checking after each removal (via `countSolutions`)
   that the puzzle *still has exactly one solution*. If removing a cell would create an
   ambiguous puzzle (two+ valid solutions), that cell is put back and generation moves
   on. This repeats until the puzzle reaches its target clue count for the chosen
   difficulty (see the table in CLAUDE.md — e.g. "expert" targets 22 clues), or until
   the generator can't safely remove any more without breaking uniqueness (so actual
   clue counts can end up slightly above target — don't assume the exact numbers in
   tests).

`generatePuzzle(difficulty, seed?)` returns both the `puzzle` (with holes) and the
`solution` (the completed grid) — the solution is kept around so the game can check
whether entries are correct without re-solving anything.

### `puzzleId.ts` — giving a puzzle a stable name

Because puzzles are generated independently by each player's browser (there's no central
server assigning puzzle #1, #2, #3...), we need a way to recognize "this is the same
puzzle" across different players so their stats can be aggregated together.
`hashSolution(board)` solves this by hashing the *solved* grid into a short string ID
(two FNV-1a hash passes, concatenated). Two players who happen to generate the same
solved grid get the same ID automatically — no coordination needed. This ID is what gets
used as the Firestore document key in `puzzleDoc.ts`/`stats.ts`.

---

## 4. Game state: the rules of playing

`game.ts` is the biggest conceptual piece to understand, and it follows one strict
pattern worth internalizing before you touch it:

> **Every function takes a `GameState` and returns a brand new `GameState`. Nothing is
> ever mutated in place.**

This is called an "immutable" or "functional" update pattern. For example:

```ts
export function selectCell(state: GameState, row: number, col: number): GameState {
  if (state.paused) return state;
  return { ...state, selected: { row, col } };
}
```

`{ ...state, selected: {...} }` creates a *new* object that copies every field from
`state`, then overwrites `selected`. The original `state` object is untouched. Why go to
this trouble instead of just doing `state.selected = {row, col}`?

- **Undo becomes trivial.** Since old states are never destroyed, `game.ts` can just keep
  a stack of past snapshots (`state.history`) and pop the last one to undo. No need to
  write "reverse" logic for every action — you just restore the previous whole state.
- **No spooky action at a distance.** If some other code is still holding a reference to
  an old `GameState`, it can't be silently changed out from under it. Bugs caused by
  "something else mutated my object without me knowing" mostly disappear.
- **Easy to reason about and test.** A pure function that takes X and returns Y (with no
  side effects) is trivial to unit test — call it, check the output. No mocking needed.

If you're adding a new action (a new button, a new game rule), follow the same pattern:
write a pure function in `game.ts` that takes `state` plus whatever arguments, and
returns a new state object. Never reach into `state` and mutate a field directly.

### Key pieces of `GameState`

- **`puzzle` / `solution` / `userBoard`** — three separate boards. `puzzle` is the
  original with holes (never changes). `solution` is the fully-solved answer (never
  changes, used only to check correctness). `userBoard` is what the player has actually
  filled in — this is the one that changes as you play.
- **`given`** — a matching 9×9 grid of `true`/`false`: was this cell pre-filled by the
  puzzle (so the player can't edit it)? Note that `applyHint` (see below) flips a cell to
  `given: true` once revealed, matching how most Sudoku apps treat hinted cells as fixed.
- **`notes`** — pencil marks. Instead of a `Set` or array per cell, each cell's notes are
  packed into a single 9-bit integer, where bit `i` (0-indexed) represents whether digit
  `i+1` is pencilled in. `notes[r][c] ^= 1 << (num - 1)` toggles a digit's bit on/off.
  This is a classic "bitmask" trick — compact, and checking/toggling a single flag is a
  single fast bitwise operation instead of searching an array. If bitwise operators are
  unfamiliar: `1 << 3` shifts the bit `1` left by 3 positions (`0b1000`), `^=` is
  "toggle this bit," `&= ~bit` is "clear this bit."
- **`history`** — the undo stack. Every mutating action pushes a `Snapshot` (a copy of
  `userBoard`, `notes`, and `mistakes` *before* the change) so `undoMove` can restore it.
- **`lockedNumber`** — supports a UX shortcut: click a number on the numpad to "lock" it,
  then click cells to place that number repeatedly without re-selecting it each time.
  Keyboard digit entry bypasses this entirely — it's a mouse/touch convenience only.
- **`started` / `paused` / `startTime` / `elapsed`** — the timer. Notably, `started`
  doesn't flip to `true` until the *first digit is entered* — so the timer isn't running
  while you're just looking at a fresh puzzle. `paused` is checked as an early-return
  guard at the top of nearly every mutating function, so even if a UI bug lets an event
  through while paused, the state simply refuses to change.

### The peer-highlighting helper

`getPeerCoords(row, col)` returns every cell that shares a row, column, or 3×3 box with
the given cell — the cells that could conflict with it under Sudoku rules. It's used both
for highlighting (showing you related cells when you select one) and for
`erasePeerNotes` (when you correctly place a digit, automatically clear that digit from
pencil notes in all peer cells — a real quality-of-life feature good Sudoku apps have).

---

## 5. The "never let backend problems block gameplay" philosophy

This is the single most repeated design decision in the codebase, so it's worth calling
out on its own. Every piece of code that talks to Firebase or `localStorage` is wrapped
in `try`/`catch` (or `.catch(console.warn)`), and failures are swallowed rather than
thrown:

- `firebase.ts` wraps `initializeApp()` in try/catch — no Firebase config (e.g. a fresh
  checkout with no `.env.local`, or CI) means `auth`/`db` are simply `undefined`, and the
  rest of the app treats "stats disabled" as a normal, fully-supported state rather than
  an error condition.
- `stats.ts` functions all throw internally if `db` is undefined, but every *caller* in
  `main.ts` catches and logs those failures instead of letting them propagate.
- `persistedGame.ts` wraps all `localStorage` access in try/catch too — a private
  browsing session or a full storage quota shouldn't crash the game.

**Why this matters for you as a contributor:** if you add a new feature that talks to
Firebase or storage, follow the same pattern. Gameplay (solving the actual puzzle) must
never depend on those systems succeeding. Ask yourself: "if this network/storage call
fails right now, does the player still get a working game?" If not, wrap it.

---

## 6. Firebase: what it's for and how the pieces connect

Firebase here is used purely for **optional account/stats features** — signing in and
remembering how you've played. If this is your first time working with Firebase, here's
the mental model:

- **Firebase Auth** handles "who is this player." Every player, even one who never
  clicks "sign in," gets an **anonymous account** behind the scenes
  (`ensureAnonymousAuth()` in `stats.ts`) so their stats have somewhere to live. If they
  later sign in with Google or email, `auth.ts` *links* that identity to the existing
  anonymous account (rather than replacing it) specifically so their play history isn't
  orphaned — this is the trickiest bit of auth logic in the app, worth reading
  `auth.ts`'s comments closely if you touch it.
- **Firestore** is the database (a NoSQL, document-based store — think nested JSON
  objects with unique IDs, not SQL tables/rows). Two main collections:
  - `puzzles/{puzzleId}` — one doc per unique puzzle (keyed by the content hash from
    `puzzleId.ts`), tracking how many times it's been played/completed.
  - `users/{uid}/plays/{puzzleId}` — one doc per user per puzzle they've completed,
    storing mistakes/time. Playing the same puzzle again *overwrites* this doc rather
    than adding a new entry — so "completions" in the stats view means distinct puzzles
    solved, not total attempts.
- **`firestore.rules`** is the server-side security config — it's what actually
  enforces who can read/write what (client-side code can be bypassed by anyone with dev
  tools open, so this file is the real gatekeeper). Unusually, it's *not* deployed via
  the Firebase CLI in this repo — changes are pasted into the Firebase Console manually,
  and verified against the live project with throwaway scratch scripts (not committed).
  If you change this file, see the "Testing notes" section of CLAUDE.md for the
  verification process.

If you're new to Firebase generally: there's no SQL, no schema migrations — you just
read/write nested documents by path, and the "schema" is really just "whatever shape the
code that reads it expects." That flexibility is nice for a small project but means the
TypeScript types describing those documents are the closest thing to a schema you'll
find — trust the code, not any external "database schema" doc, because there isn't one.

---

## 7. Daily puzzles and the calendar

Worth calling out separately since it's a slightly clever bit of design:

- `dailyPuzzle.ts` turns today's UTC date into a seed (`dailySeed`) and feeds it into
  `generatePuzzle`. Because this is a pure function of the date, **every player's browser
  computes the identical puzzle independently** — there's no "puzzle of the day" stored
  centrally that clients fetch. Firestore only records that the daily puzzle *happened*
  (for stats), it's never a dependency for actually playing it.
- The calendar overlay lets you browse past days and replay their daily puzzle. Since
  there's no "started but unfinished" record kept for arbitrary past dates, a day's
  status is deliberately two-state only: `completed` or `not-completed` (see
  `calendarView.ts`) — there's no partial-progress indicator for old dates.

---

## 8. `main.ts`: where everything meets the screen

This file is intentionally the least "clever" file in the codebase — mostly
straightforward DOM manipulation: find elements, attach event listeners, call a `game.ts`
function on click/keypress, then re-render. A few things worth knowing before you dive
in:

- **`render()` is the single re-draw function.** After (almost) any state change, `main.ts`
  calls one function that re-paints the whole board/numpad from the current `state`,
  rather than trying to surgically patch just what changed. For a 9×9 grid this is cheap
  enough that it's not worth the complexity of a smarter diffing approach — a good
  example of not over-engineering for a problem size that doesn't need it.
- **A module-level `gameGeneration` counter guards against race conditions.** Puzzle
  generation runs asynchronously (with a small `setTimeout` yield so the loading spinner
  can actually paint before the CPU-heavy backtracking work blocks the main thread). If
  you rapidly click "New Game" twice, the first (slower) generation could otherwise
  finish *after* the second and stomp on it with stale data. The counter makes each call
  check "am I still the most recent request?" before applying its result — a pattern
  worth remembering any time you have async work that can be superseded by a newer call.
- **Auto-save on every render.** `saveGame()` is called after each state change so a
  backgrounded/discarded tab can resume where you left off (`persistedGame.ts`). Extra
  `visibilitychange`/`pagehide` listeners exist because the timer ticks `state.elapsed`
  once per second *without* going through `render()`, so those events are the only
  chance to persist that particular field before the tab disappears.

---

## 9. Testing conventions worth knowing

- Tests use **Vitest** with the `happy-dom` environment (not plain Node) — several
  modules (`auth.ts` especially) touch `window.localStorage`/`location`, which don't
  exist under a bare Node test environment.
- `solve`/`countSolutions` are *not* unit tested directly — they're backtracking
  algorithms that are too slow on unconstrained boards to run in a fast test suite. Only
  `isValid` (the cheap primitive they're built from) is tested directly.
- Puzzle generation tests check *relative* clue counts (e.g. "expert has fewer clues than
  easy"), never the exact target numbers, since generation can legitimately stop early.
- End-to-end tests (Playwright) re-query the DOM after every action rather than caching a
  locator — e.g. `.cell:not(.given)` is a *live* query, so once a hint reveals a cell it
  silently drops out of that selector on the next re-evaluation. If you're acting on a
  specific cell across multiple steps, capture its `data-row`/`data-col` attributes and
  re-locate by those, rather than trusting an earlier locator reference to still point at
  the same element.

---

## 10. Suggested reading order for a first pass

If you want to actually build a mental model rather than just skim, read in this order:

1. `solver.ts` (small, self-contained, teaches you backtracking)
2. `rng.ts` (tiny — just understand *why* a seed matters)
3. `generator.ts` (builds on 1 and 2)
4. `game.ts` (the biggest file conceptually — take your time, note the immutable-update
   pattern repeated in every function)
5. `main.ts` (skim first for structure, then trace one full flow: clicking a cell →
   `selectCell` → `render()`)
6. `firebase.ts` → `stats.ts` → `auth.ts` (the optional layer, read once you're
   comfortable with the core game)

From there, CLAUDE.md's Architecture section will read as a quick-reference index rather
than a wall of unfamiliar file names, and `docs/HISTORY.md` has the dated "why did we
build it this way" write-ups for individual features if you want more historical context
on a specific decision.
