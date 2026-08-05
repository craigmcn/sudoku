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

// happy-dom's Window doesn't implement localStorage out of the box (see
// auth.test.ts) — stub it with a small in-memory Storage.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureAnonymousAuth.mockResolvedValue({ uid: 'test-uid' });
  mocks.ensurePuzzleDoc.mockResolvedValue(undefined);
  mocks.requireDb.mockReturnValue({ __db: true });
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
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

describe('dailyPuzzleId', () => {
  it('matches hashSolution(generateDailyPuzzle(date, difficulty).solution)', async () => {
    const { dailyPuzzleId, generateDailyPuzzle } = await import('./dailyPuzzle');
    const { hashSolution } = await import('./puzzleId');
    const { solution } = generateDailyPuzzle('2026-07-19', 'hard');
    expect(dailyPuzzleId('2026-07-19', 'hard')).toBe(hashSolution(solution));
  });

  it('is stable across repeated calls for the same date+difficulty', async () => {
    const { dailyPuzzleId } = await import('./dailyPuzzle');
    expect(dailyPuzzleId('2026-07-20', 'normal')).toBe(
      dailyPuzzleId('2026-07-20', 'normal'),
    );
  });

  it('persists computed ids to localStorage so a later session can skip generation', async () => {
    const { dailyPuzzleId } = await import('./dailyPuzzle');
    // 'easy' rather than 'expert' — this test only cares about the
    // localStorage write path, not generation itself, and 'expert''s
    // uniqueness-check backtracking has a seed-dependent worst case slow
    // enough on CI hardware to trip vitest's default 5s per-test timeout
    // (observed in CI on PR #58 for this exact date+'expert' pairing, while
    // other tests here generating 'expert' for different dates stayed
    // under it — see generator.ts's removal-loop countSolutions calls).
    const id = dailyPuzzleId('2026-07-21', 'easy');
    // Persisting is debounced to a microtask (scheduleFlush) — flush it.
    await Promise.resolve();
    const raw = localStorage.getItem('sudoku-daily-puzzle-id-cache-v1');
    expect(raw).not.toBeNull();
    const cache = JSON.parse(raw!) as Record<string, string>;
    expect(cache['2026-07-21:easy']).toBe(id);
  });

  it('falls back to an empty cache rather than throwing when localStorage holds corrupted JSON', async () => {
    // The literal string 'null' is valid JSON — JSON.parse succeeds without
    // throwing and returns `null`, which would previously crash the very
    // next `persisted[key]` access if trusted as-is.
    localStorage.setItem('sudoku-daily-puzzle-id-cache-v1', 'null');
    // Force a fresh module instance so loadPersistedCache re-reads
    // localStorage instead of returning an already-populated in-memory cache
    // from an earlier test in this file.
    vi.resetModules();
    const { dailyPuzzleId, generateDailyPuzzle } = await import('./dailyPuzzle');
    const { hashSolution } = await import('./puzzleId');

    expect(() => dailyPuzzleId('2026-07-22', 'easy')).not.toThrow();
    const { solution } = generateDailyPuzzle('2026-07-22', 'easy');
    expect(dailyPuzzleId('2026-07-22', 'easy')).toBe(hashSolution(solution));
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
