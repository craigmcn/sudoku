import { Board, isValid, countSolutions } from './solver';
import { mulberry32, Rng } from './rng';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

// Number of given clues to leave visible per difficulty
const CLUE_COUNTS: Record<Difficulty, number> = {
  easy: 46,
  normal: 36,
  hard: 28,
  expert: 22,
};

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateFilledBoard(rng: Rng): Board {
  const board: Board = Array.from({ length: 9 }, () => Array(9).fill(null));
  fill(board, rng);
  return board;
}

function fill(board: Board, rng: Rng): boolean {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col] === null) {
        for (const num of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
          if (isValid(board, row, col, num)) {
            board[row][col] = num;
            if (fill(board, rng)) return true;
            board[row][col] = null;
          }
        }
        return false;
      }
    }
  }
  return true;
}

// `seed` makes generation reproducible (needed for daily puzzles and for
// hashing a puzzle's identity from its inputs); omitting it falls back to
// Math.random for ordinary one-off play, unchanged from prior behavior.
export function generatePuzzle(
  difficulty: Difficulty,
  seed?: number,
): { puzzle: Board; solution: Board } {
  const rng: Rng = seed === undefined ? Math.random : mulberry32(seed);
  const solution = generateFilledBoard(rng);
  const puzzle: Board = solution.map((row) => [...row]);

  const toRemove = 81 - CLUE_COUNTS[difficulty];
  const positions = shuffle(
    Array.from({ length: 81 }, (_, i) => i),
    rng,
  );
  let removed = 0;

  for (const pos of positions) {
    if (removed >= toRemove) break;

    const row = Math.floor(pos / 9);
    const col = pos % 9;
    const backup = puzzle[row][col]!;

    puzzle[row][col] = null;

    // countSolutions restores the board after running, so no deep copy needed
    if (countSolutions(puzzle) === 1) {
      removed++;
    } else {
      puzzle[row][col] = backup;
    }
  }

  return { puzzle, solution };
}
