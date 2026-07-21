import { describe, expect, it } from 'vitest';
import type { UserPlay } from './stats';
import {
  formatDifficultyLabel,
  formatElapsed,
  summarizeByDifficulty,
} from './statsView';

function play(overrides: Partial<UserPlay> = {}): UserPlay {
  return {
    puzzleId: 'abc',
    difficulty: 'easy',
    mistakes: 0,
    elapsedMs: 60_000,
    completedAt: new Date('2026-07-21T00:00:00Z'),
    ...overrides,
  };
}

describe('summarizeByDifficulty', () => {
  it('returns zeroed/null summaries for every difficulty when there are no plays', () => {
    const summary = summarizeByDifficulty([]);

    expect(summary).toEqual({
      easy: { completions: 0, bestMs: null, avgMs: null },
      normal: { completions: 0, bestMs: null, avgMs: null },
      hard: { completions: 0, bestMs: null, avgMs: null },
      expert: { completions: 0, bestMs: null, avgMs: null },
    });
  });

  it('counts completions and computes best/avg per difficulty', () => {
    const plays = [
      play({ difficulty: 'easy', elapsedMs: 120_000 }),
      play({ difficulty: 'easy', elapsedMs: 60_000 }),
      play({ difficulty: 'hard', elapsedMs: 300_000 }),
    ];

    const summary = summarizeByDifficulty(plays);

    expect(summary.easy).toEqual({
      completions: 2,
      bestMs: 60_000,
      avgMs: 90_000,
    });
    expect(summary.hard).toEqual({
      completions: 1,
      bestMs: 300_000,
      avgMs: 300_000,
    });
    expect(summary.normal).toEqual({
      completions: 0,
      bestMs: null,
      avgMs: null,
    });
  });
});

describe('formatElapsed', () => {
  it('formats milliseconds as mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(3_661_000)).toBe('61:01');
  });

  it('rounds to the nearest second', () => {
    expect(formatElapsed(59_600)).toBe('01:00');
  });
});

describe('formatDifficultyLabel', () => {
  it('capitalizes the difficulty', () => {
    expect(formatDifficultyLabel('easy')).toBe('Easy');
    expect(formatDifficultyLabel('expert')).toBe('Expert');
  });
});
