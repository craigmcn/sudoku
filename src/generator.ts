import { Board, isValid, countSolutions } from './solver';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

// Number of given clues to leave visible per difficulty
const CLUE_COUNTS: Record<Difficulty, number> = {
  easy: 46,
  normal: 36,
  hard: 28,
  expert: 22,
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateFilledBoard(): Board {
  const board: Board = Array.from({ length: 9 }, () => Array(9).fill(null));
  fill(board);
  return board;
}

function fill(board: Board): boolean {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col] === null) {
        for (const num of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
          if (isValid(board, row, col, num)) {
            board[row][col] = num;
            if (fill(board)) return true;
            board[row][col] = null;
          }
        }
        return false;
      }
    }
  }
  return true;
}

export function generatePuzzle(difficulty: Difficulty): { puzzle: Board; solution: Board } {
  const solution = generateFilledBoard();
  const puzzle: Board = solution.map(row => [...row]);

  const toRemove = 81 - CLUE_COUNTS[difficulty];
  const positions = shuffle(Array.from({ length: 81 }, (_, i) => i));
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
