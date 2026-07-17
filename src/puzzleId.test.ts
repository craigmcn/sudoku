import { describe, expect, it } from 'vitest';
import { hashSolution } from './puzzleId';
import type { Board } from './solver';

const SOLUTION: Board = [
  [5, 3, 4, 6, 7, 8, 9, 1, 2],
  [6, 7, 2, 1, 9, 5, 3, 4, 8],
  [1, 9, 8, 3, 4, 2, 5, 6, 7],
  [8, 5, 9, 7, 6, 1, 4, 2, 3],
  [4, 2, 6, 8, 5, 3, 7, 9, 1],
  [7, 1, 3, 9, 2, 4, 8, 5, 6],
  [9, 6, 1, 5, 3, 7, 2, 8, 4],
  [2, 8, 7, 4, 1, 9, 6, 3, 5],
  [3, 4, 5, 2, 8, 6, 1, 7, 9],
];

function swapFirstRow(board: Board): Board {
  const copy = board.map((row) => [...row]);
  [copy[0][0], copy[0][1]] = [copy[0][1], copy[0][0]];
  return copy;
}

describe('hashSolution', () => {
  it('is deterministic for the same board', () => {
    expect(hashSolution(SOLUTION)).toBe(hashSolution(SOLUTION));
  });

  it('differs for different boards', () => {
    expect(hashSolution(SOLUTION)).not.toBe(
      hashSolution(swapFirstRow(SOLUTION)),
    );
  });

  it('returns a non-empty string', () => {
    expect(hashSolution(SOLUTION).length).toBeGreaterThan(0);
  });
});
