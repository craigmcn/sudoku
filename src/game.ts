import { Board } from './solver';
import { Difficulty, generatePuzzle } from './generator';

export type { Difficulty };

export interface GameState {
  puzzle: Board;
  solution: Board;
  userBoard: Board;
  given: boolean[][];
  selected: { row: number; col: number } | null;
  // notes[r][c] is a bitmask: bit i set means number (i+1) is noted
  notes: number[][];
  notesMode: boolean;
  difficulty: Difficulty;
  startTime: number;
  elapsed: number;
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

// Returns the coordinates of all 20 peer cells (same row, col, and box).
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

export function createGame(difficulty: Difficulty): GameState {
  const { puzzle, solution } = generatePuzzle(difficulty);

  const given: boolean[][] = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => puzzle[r][c] !== null),
  );

  return {
    puzzle,
    solution,
    userBoard: cloneBoard(puzzle),
    given,
    selected: null,
    notes: Array.from({ length: 9 }, () => Array(9).fill(0)),
    notesMode: false,
    difficulty,
    startTime: Date.now(),
    elapsed: 0,
    solved: false,
    mistakes: 0,
    history: [],
  };
}

export function selectCell(state: GameState, row: number, col: number): GameState {
  if (state.selected?.row === row && state.selected?.col === col) {
    return { ...state, selected: null };
  }
  return { ...state, selected: { row, col } };
}

export function enterNumber(state: GameState, num: number): GameState {
  const { selected, given, solution, notesMode } = state;
  if (!selected) return state;
  const { row, col } = selected;
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

  return {
    ...state,
    userBoard,
    notes,
    mistakes,
    solved,
    history: [...state.history, snapshot],
  };
}

export function eraseCell(state: GameState): GameState {
  const { selected, given } = state;
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
  return { ...state, notesMode: !state.notesMode };
}

export function applyHint(state: GameState): GameState {
  const { selected, given, solution } = state;
  if (!selected) return state;
  const { row, col } = selected;
  if (given[row][col] && state.userBoard[row][col] === solution[row][col]) return state;

  const snapshot = takeSnapshot(state);

  const userBoard = cloneBoard(state.userBoard);
  const notes = cloneNotes(state.notes);
  const newGiven = state.given.map(r => [...r]);

  userBoard[row][col] = solution[row][col];
  notes[row][col] = 0;
  newGiven[row][col] = true;

  const solved = checkSolved(userBoard, solution);
  return {
    ...state,
    userBoard,
    notes,
    given: newGiven,
    solved,
    history: [...state.history, snapshot],
  };
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
