import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Difficulty } from './generator';

const mocks = vi.hoisted(() => ({
  doc: vi.fn(() => ({ __ref: true })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  ensureAnonymousAuth: vi.fn(() => Promise.resolve({ uid: 'test-uid' })),
  ensurePuzzleDoc: vi.fn((...args: unknown[]) => {
    void args;
    return Promise.resolve();
  }),
  requireDb: vi.fn(() => ({ __db: true })),
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  setDoc: mocks.setDoc,
}));

vi.mock('./stats', () => ({
  ensureAnonymousAuth: mocks.ensureAnonymousAuth,
}));

vi.mock('./puzzleDoc', () => ({
  ensurePuzzleDoc: mocks.ensurePuzzleDoc,
  requireDb: mocks.requireDb,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureAnonymousAuth.mockResolvedValue({ uid: 'test-uid' });
  mocks.ensurePuzzleDoc.mockResolvedValue(undefined);
  mocks.requireDb.mockReturnValue({ __db: true });
});

describe('seedFromString', () => {
  it('is deterministic for the same input', async () => {
    const { seedFromString } = await import('./dailyPuzzle');
    expect(seedFromString('2026-07-17:easy')).toBe(seedFromString('2026-07-17:easy'));
  });

  it('differs across distinct inputs', async () => {
    const { seedFromString } = await import('./dailyPuzzle');
    expect(seedFromString('2026-07-17:easy')).not.toBe(seedFromString('2026-07-17:normal'));
    expect(seedFromString('2026-07-17:easy')).not.toBe(seedFromString('2026-07-18:easy'));
  });
});

describe('todayUtc', () => {
  it('formats as yyyy-mm-dd in UTC', async () => {
    const { todayUtc } = await import('./dailyPuzzle');
    expect(todayUtc(new Date('2026-07-17T23:30:00Z'))).toBe('2026-07-17');
    expect(todayUtc(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });
});

describe('dailySeed', () => {
  it('is deterministic per date+difficulty and varies across both', async () => {
    const { dailySeed } = await import('./dailyPuzzle');
    expect(dailySeed('2026-07-17', 'easy')).toBe(dailySeed('2026-07-17', 'easy'));
    expect(dailySeed('2026-07-17', 'easy')).not.toBe(dailySeed('2026-07-17', 'hard'));
    expect(dailySeed('2026-07-17', 'easy')).not.toBe(dailySeed('2026-07-18', 'easy'));
  });
});

describe('dailyRandomDifficulty', () => {
  it('always picks from easy/normal/hard, never expert', async () => {
    const { dailyRandomDifficulty } = await import('./dailyPuzzle');
    const pool: Difficulty[] = ['easy', 'normal', 'hard'];
    for (let day = 1; day <= 28; day++) {
      const date = `2026-07-${String(day).padStart(2, '0')}`;
      expect(pool).toContain(dailyRandomDifficulty(date));
    }
  });

  it('is deterministic for a given date', async () => {
    const { dailyRandomDifficulty } = await import('./dailyPuzzle');
    expect(dailyRandomDifficulty('2026-07-17')).toBe(dailyRandomDifficulty('2026-07-17'));
  });
});

describe('generateDailyPuzzle', () => {
  it('produces the same puzzle and solution across calls for the same date+difficulty', async () => {
    const { generateDailyPuzzle } = await import('./dailyPuzzle');
    const a = generateDailyPuzzle('2026-07-17', 'easy');
    const b = generateDailyPuzzle('2026-07-17', 'easy');
    expect(a.solution).toEqual(b.solution);
    expect(a.puzzle).toEqual(b.puzzle);
  });

  it('produces a different puzzle for a different date', async () => {
    const { generateDailyPuzzle } = await import('./dailyPuzzle');
    const a = generateDailyPuzzle('2026-07-17', 'easy');
    const b = generateDailyPuzzle('2026-07-18', 'easy');
    expect(a.solution).not.toEqual(b.solution);
  });
});

describe('cacheDailyPuzzles', () => {
  it('ensures a puzzle doc for all four difficulties, marked isDaily for the date', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });

    const { cacheDailyPuzzles } = await import('./dailyPuzzle');
    await cacheDailyPuzzles('2026-07-17');

    expect(mocks.ensurePuzzleDoc).toHaveBeenCalledTimes(4);
    const difficulties = mocks.ensurePuzzleDoc.mock.calls.map(call => call[1]);
    expect(difficulties.sort()).toEqual(['easy', 'expert', 'hard', 'normal']);
    for (const call of mocks.ensurePuzzleDoc.mock.calls) {
      expect(call[4]).toEqual({ isDaily: true, dailyDate: '2026-07-17' });
    }
  });

  it('writes the dailyPuzzles/{date} doc with all four ids plus a random pick when absent', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });

    const { cacheDailyPuzzles } = await import('./dailyPuzzle');
    await cacheDailyPuzzles('2026-07-17');

    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    const [, docData] = mocks.setDoc.mock.calls[0];
    expect(Object.keys(docData).sort()).toEqual(['easy', 'expert', 'hard', 'normal', 'random']);
    expect(['easy', 'normal', 'hard'].map(d => docData[d])).toContain(docData.random);
  });

  it('skips all generation and writes when dailyPuzzles/{date} already exists', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true });

    const { cacheDailyPuzzles } = await import('./dailyPuzzle');
    await cacheDailyPuzzles('2026-07-17');

    // The existence check must run before any puzzle generation/doc-creation
    // work — see PR #23 Copilot review: checking last meant every call paid
    // for 4 puzzle generations + transactions even once a date was cached.
    expect(mocks.ensurePuzzleDoc).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('treats a permission-denied race on the create as success', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    mocks.setDoc.mockRejectedValue({ code: 'permission-denied' });

    const { cacheDailyPuzzles } = await import('./dailyPuzzle');
    await expect(cacheDailyPuzzles('2026-07-17')).resolves.toBeUndefined();
  });

  it('rethrows other Firestore errors from the create', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    mocks.setDoc.mockRejectedValue({ code: 'unavailable' });

    const { cacheDailyPuzzles } = await import('./dailyPuzzle');
    await expect(cacheDailyPuzzles('2026-07-17')).rejects.toEqual({ code: 'unavailable' });
  });
});
