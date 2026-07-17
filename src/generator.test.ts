import { describe, expect, it } from 'vitest';
import { generatePuzzle } from './generator';

describe('generatePuzzle', () => {
  it('produces the same puzzle and solution for the same seed', () => {
    const a = generatePuzzle('easy', 42);
    const b = generatePuzzle('easy', 42);
    expect(a.solution).toEqual(b.solution);
    expect(a.puzzle).toEqual(b.puzzle);
  });

  it('produces different puzzles for different seeds', () => {
    const a = generatePuzzle('easy', 1);
    const b = generatePuzzle('easy', 2);
    expect(a.solution).not.toEqual(b.solution);
  });

  // 'expert' removes the most cells, so it exercises the seed's path through
  // countSolutions-driven removal (not just the fill step) the heaviest of
  // any difficulty — see issue #20.
  it('produces the same puzzle and solution for the same seed on expert', () => {
    const a = generatePuzzle('expert', 42);
    const b = generatePuzzle('expert', 42);
    expect(a.solution).toEqual(b.solution);
    expect(a.puzzle).toEqual(b.puzzle);
  });
});
