export type Board = (number | null)[][];

export function isValid(board: Board, row: number, col: number, num: number): boolean {
  for (let c = 0; c < 9; c++) {
    if (c !== col && board[row][c] === num) return false;
  }
  for (let r = 0; r < 9; r++) {
    if (r !== row && board[r][col] === num) return false;
  }
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = br; r < br + 3; r++) {
    for (let c = bc; c < bc + 3; c++) {
      if ((r !== row || c !== col) && board[r][c] === num) return false;
    }
  }
  return true;
}

export function solve(board: Board): boolean {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col] === null) {
        for (let num = 1; num <= 9; num++) {
          if (isValid(board, row, col, num)) {
            board[row][col] = num;
            if (solve(board)) return true;
            board[row][col] = null;
          }
        }
        return false;
      }
    }
  }
  return true;
}

// Counts solutions up to `max`. Stops early once max is reached.
// The board is restored to its state on entry after this call.
export function countSolutions(board: Board, max = 2): number {
  let count = 0;

  function bt(): void {
    if (count >= max) return;
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (board[row][col] === null) {
          for (let num = 1; num <= 9; num++) {
            if (count >= max) return;
            if (isValid(board, row, col, num)) {
              board[row][col] = num;
              bt();
              board[row][col] = null;
            }
          }
          return; // dead end, backtrack
        }
      }
    }
    count++; // all cells filled = valid solution
  }

  bt();
  return count;
}
