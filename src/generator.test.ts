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
});
