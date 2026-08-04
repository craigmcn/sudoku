import { Board } from './solver';
import { Difficulty, generatePuzzle } from './generator';
import { hashSolution } from './puzzleId';

export type { Difficulty };

export interface GameState {
  puzzle: Board;
  solution: Board;
  // Content hash of `solution`, used to key the puzzles/{puzzleId} Firestore
  // doc for dedup/stats — see src/puzzleId.ts and src/stats.ts.
  puzzleId: string;
  userBoard: Board;
  given: boolean[][];
  selected: { row: number; col: number } | null;
  // notes[r][c] is a bitmask: bit i set means number (i+1) is noted
  notes: number[][];
  notesMode: boolean;
  // Set via the numpad to let cell clicks place/note this number repeatedly
  // without reselecting it each time — see setLockedNumber and
  // applyLockedNumber below (issue #44). Keyboard digit entry (enterNumber)
  // deliberately bypasses this field entirely.
  lockedNumber: number | null;
  difficulty: Difficulty;
  startTime: number;
  elapsed: number;
  started: boolean;
  paused: boolean;
  solved: boolean;
  mistakes: number;
  history: Snapshot[];
}

interface Snapshot {
  userBoard: Board;
  notes: number[][];
  mistakes: number;
}

function cloneBoard(b: Board): Board {
  return b.map(r => [...r]);
}

function cloneNotes(n: number[][]): number[][] {
  return n.map(r => [...r]);
}

function takeSnapshot(state: GameState): Snapshot {
  return {
    userBoard: cloneBoard(state.userBoard),
    notes: cloneNotes(state.notes),
    mistakes: state.mistakes,
  };
}

export function getPeerCoords(row: number, col: number): Array<[number, number]> {
  const peers: Array<[number, number]> = [];
  for (let c = 0; c < 9; c++) if (c !== col) peers.push([row, c]);
  for (let r = 0; r < 9; r++) if (r !== row) peers.push([r, col]);
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = br; r < br + 3; r++)
    for (let c = bc; c < bc + 3; c++)
      if (r !== row && c !== col) peers.push([r, c]); // row/col already covered above
  return peers;
}

// Toggles a single note bit at (row, col) for the given digit.
export function toggleNote(
  notes: number[][],
  row: number,
  col: number,
  num: number,
): number[][] {
  const next = cloneNotes(notes);
  next[row][col] ^= 1 << (num - 1);
  return next;
}

// Clears the bit for `num` from every peer of (row, col).
export function erasePeerNotes(
  notes: number[][],
  row: number,
  col: number,
  num: number,
): number[][] {
  const next = cloneNotes(notes);
  const bit = 1 << (num - 1);
  for (const [r, c] of getPeerCoords(row, col)) {
    next[r][c] &= ~bit;
  }
  return next;
}

// `seed` makes the puzzle reproducible (daily puzzles, see src/dailyPuzzle.ts);
// omitting it generates a fresh random puzzle, unchanged from prior behavior.
export function createGame(difficulty: Difficulty, seed?: number): GameState {
  const { puzzle, solution } = generatePuzzle(difficulty, seed);

  const given: boolean[][] = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => puzzle[r][c] !== null),
  );

  return {
    puzzle,
    solution,
    puzzleId: hashSolution(solution),
    userBoard: cloneBoard(puzzle),
    given,
    selected: null,
    notes: Array.from({ length: 9 }, () => Array(9).fill(0)),
    notesMode: false,
    lockedNumber: null,
    difficulty,
    startTime: Date.now(),
    elapsed: 0,
    started: false,
    paused: false,
    solved: false,
    mistakes: 0,
    history: [],
  };
}

export function selectCell(state: GameState, row: number, col: number): GameState {
  if (state.paused) return state;
  if (state.selected?.row === row && state.selected?.col === col) {
    return { ...state, selected: null };
  }
  return { ...state, selected: { row, col } };
}

export function enterNumberAt(
  state: GameState,
  row: number,
  col: number,
  num: number,
): GameState {
  const { given, solution, notesMode } = state;
  if (state.paused) return state;
  if (given[row][col]) return state;

  const snapshot = takeSnapshot(state);

  if (notesMode) {
    return {
      ...state,
      notes: toggleNote(state.notes, row, col, num),
      history: [...state.history, snapshot],
    };
  }

  const userBoard = cloneBoard(state.userBoard);
  userBoard[row][col] = num;

  // Clear this cell's notes; if correct, also erase that digit from all peers
  const clearedNotes = cloneNotes(state.notes);
  clearedNotes[row][col] = 0;
  const notes =
    num === solution[row][col] ? erasePeerNotes(clearedNotes, row, col, num) : clearedNotes;

  const mistakes = num !== solution[row][col] ? state.mistakes + 1 : state.mistakes;
  const solved = checkSolved(userBoard, solution);

  const next = {
    ...state,
    userBoard,
    notes,
    mistakes,
    solved,
    started: true,
    history: [...state.history, snapshot],
  };
  return clearLockIfCompleted(next, num);
}

export function enterNumber(state: GameState, num: number): GameState {
  if (!state.selected) return state;
  return enterNumberAt(state, state.selected.row, state.selected.col, num);
}

// Toggles `num` as the locked number: clicking the same number again unlocks
// it. Locking a different number replaces the previous lock outright.
export function setLockedNumber(state: GameState, num: number): GameState {
  if (state.paused) return state;
  return { ...state, lockedNumber: state.lockedNumber === num ? null : num };
}

function countPlaced(board: Board, num: number): number {
  let count = 0;
  for (const row of board) for (const v of row) if (v === num) count++;
  return count;
}

// Clears lockedNumber once the digit it points at has all 9 instances placed
// on the board — called after every mutation that can complete a digit
// (enterNumberAt, so both keyboard entry and locked-cell clicks are covered;
// applyHint too), so the lock never goes stale and silently keeps applying
// an already-finished digit to whatever cell is clicked next.
function clearLockIfCompleted(state: GameState, num: number): GameState {
  if (state.lockedNumber !== num) return state;
  return countPlaced(state.userBoard, num) >= 9 ? { ...state, lockedNumber: null } : state;
}

// Applies the currently locked number to (row, col) — entering it as a value
// or toggling it as a note, matching notesMode — and selects that cell so
// peer highlighting tracks the click. No-ops if nothing is locked.
export function applyLockedNumber(state: GameState, row: number, col: number): GameState {
  if (state.paused) return state;
  if (state.lockedNumber === null) return state;
  const next = enterNumberAt(state, row, col, state.lockedNumber);
  return { ...next, selected: { row, col } };
}

export type ResetScope = 'all' | 'entries' | 'notes';

// Clears user progress on all non-given cells, scoped to entered values,
// pencil notes, or both. Given cells, mistakes, and elapsed time are never
// touched — resetting the board isn't a new puzzle, so those don't reset.
export function resetBoard(state: GameState, scope: ResetScope): GameState {
  if (state.paused) return state;

  const userBoard = cloneBoard(state.userBoard);
  const notes = cloneNotes(state.notes);
  let changed = false;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (state.given[r][c]) continue;
      if (scope === 'all' || scope === 'entries') {
        if (userBoard[r][c] !== null) changed = true;
        userBoard[r][c] = null;
      }
      if (scope === 'all' || scope === 'notes') {
        if (notes[r][c] !== 0) changed = true;
        notes[r][c] = 0;
      }
    }
  }

  // Nothing to clear for this scope — return the original state as-is
  // rather than pushing a no-op undo entry, matching eraseCell's pattern.
  if (!changed) return state;

  const snapshot = takeSnapshot(state);

  return {
    ...state,
    userBoard,
    notes,
    // Derived from the resulting board rather than hardcoded, so a
    // notes-only reset on an already-solved board (entries untouched)
    // correctly leaves `solved` true.
    solved: checkSolved(userBoard, state.solution),
    history: [...state.history, snapshot],
  };
}

export function eraseCell(state: GameState): GameState {
  const { selected, given } = state;
  if (state.paused) return state;
  if (!selected) return state;
  const { row, col } = selected;
  if (given[row][col]) return state;
  if (state.userBoard[row][col] === null && state.notes[row][col] === 0) return state;

  const snapshot = takeSnapshot(state);

  const userBoard = cloneBoard(state.userBoard);
  const notes = cloneNotes(state.notes);
  userBoard[row][col] = null;
  notes[row][col] = 0;

  return { ...state, userBoard, notes, history: [...state.history, snapshot] };
}

export function undoMove(state: GameState): GameState {
  if (state.paused) return state;
  if (state.history.length === 0) return state;
  const history = [...state.history];
  const snap = history.pop()!;
  return {
    ...state,
    userBoard: snap.userBoard,
    notes: snap.notes,
    mistakes: snap.mistakes,
    history,
    solved: false,
  };
}

export function toggleNotesMode(state: GameState): GameState {
  if (state.paused) return state;
  return { ...state, notesMode: !state.notesMode };
}

export function pauseGame(state: GameState): GameState {
  if (!state.started || state.paused || state.solved) return state;
  // Sync elapsed to the moment of pausing rather than the last 1s timer tick
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  return { ...state, paused: true, elapsed };
}

export function resumeGame(state: GameState): GameState {
  if (!state.paused) return state;
  // Re-anchor startTime so elapsed continues from where it left off
  return { ...state, paused: false, startTime: Date.now() - state.elapsed * 1000 };
}

export function togglePause(state: GameState): GameState {
  return state.paused ? resumeGame(state) : pauseGame(state);
}

export function applyHint(state: GameState): GameState {
  const { selected, given, solution } = state;
  if (state.paused) return state;
  if (!selected) return state;
  const { row, col } = selected;
  // No-op if the cell is already correctly filled (covers given cells)
  if (given[row][col] && state.userBoard[row][col] === solution[row][col]) return state;

  const snapshot = takeSnapshot(state);

  const userBoard = cloneBoard(state.userBoard);
  const notes = cloneNotes(state.notes);
  const newGiven = state.given.map(r => [...r]);

  const revealed = solution[row][col]!;
  userBoard[row][col] = revealed;
  notes[row][col] = 0;
  newGiven[row][col] = true;

  const solved = checkSolved(userBoard, solution);
  const next = {
    ...state,
    userBoard,
    notes,
    given: newGiven,
    solved,
    started: true,
    history: [...state.history, snapshot],
  };
  return clearLockIfCompleted(next, revealed);
}

export function getConflicts(state: GameState): Set<string> {
  const { userBoard } = state;
  const conflicts = new Set<string>();

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const val = userBoard[row][col];
      if (val === null) continue;

      for (const [r, c] of getPeerCoords(row, col)) {
        if (userBoard[r][c] === val) {
          conflicts.add(`${row},${col}`);
          conflicts.add(`${r},${c}`);
        }
      }
    }
  }

  return conflicts;
}

function checkSolved(userBoard: Board, solution: Board): boolean {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (userBoard[r][c] !== solution[r][c]) return false;
  return true;
}
