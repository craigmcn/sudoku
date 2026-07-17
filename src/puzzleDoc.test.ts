import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from './solver';

const mocks = vi.hoisted(() => ({
  doc: vi.fn(() => ({ __ref: true })),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => '__serverTimestamp__'),
  db: { __db: true } as { __db: true } | undefined,
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  runTransaction: mocks.runTransaction,
  serverTimestamp: mocks.serverTimestamp,
}));

vi.mock('./firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

const testBoard: Board = Array.from({ length: 9 }, (_, r) =>
  Array.from({ length: 9 }, (_, c) => (r === 0 && c === 0 ? 5 : null)),
);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.db = { __db: true };
});

describe('boardToRows', () => {
  it('converts each row to a 9-character string with 0 for blanks', async () => {
    const { boardToRows } = await import('./puzzleDoc');
    const rows = boardToRows(testBoard);

    expect(rows).toHaveLength(9);
    expect(rows[0]).toBe('500000000');
    expect(rows[1]).toBe('000000000');
  });
});

describe('requireDb', () => {
  it('returns db when configured', async () => {
    const { requireDb } = await import('./puzzleDoc');
    expect(requireDb()).toBe(mocks.db);
  });

  it('throws when Firestore failed to initialize', async () => {
    mocks.db = undefined;
    const { requireDb } = await import('./puzzleDoc');
    expect(() => requireDb()).toThrow('Firebase Firestore is not configured');
  });
});

describe('ensurePuzzleDoc', () => {
  it('creates the doc with default (non-daily) fields when it does not exist', async () => {
    const set = vi.fn();
    mocks.runTransaction.mockImplementation(async (_db, updateFn) => {
      await updateFn({ get: async () => ({ exists: () => false }), set });
    });

    const { ensurePuzzleDoc } = await import('./puzzleDoc');
    await ensurePuzzleDoc('abc123', 'easy', testBoard, 'abc123');

    expect(set).toHaveBeenCalledTimes(1);
    const [, docData] = set.mock.calls[0];
    expect(docData).toMatchObject({
      difficulty: 'easy',
      solutionHash: 'abc123',
      timesPlayed: 0,
      totalPlayTimeMs: 0,
      completions: 0,
      isDaily: false,
    });
    expect(docData.dailyDate).toBeUndefined();
  });

  it('creates the doc with isDaily/dailyDate when passed', async () => {
    const set = vi.fn();
    mocks.runTransaction.mockImplementation(async (_db, updateFn) => {
      await updateFn({ get: async () => ({ exists: () => false }), set });
    });

    const { ensurePuzzleDoc } = await import('./puzzleDoc');
    await ensurePuzzleDoc('abc123', 'easy', testBoard, 'abc123', {
      isDaily: true,
      dailyDate: '2026-07-17',
    });

    const [, docData] = set.mock.calls[0];
    expect(docData.isDaily).toBe(true);
    expect(docData.dailyDate).toBe('2026-07-17');
  });

  it('does not write when the doc already exists', async () => {
    const set = vi.fn();
    mocks.runTransaction.mockImplementation(async (_db, updateFn) => {
      await updateFn({ get: async () => ({ exists: () => true }), set });
    });

    const { ensurePuzzleDoc } = await import('./puzzleDoc');
    await ensurePuzzleDoc('abc123', 'easy', testBoard, 'abc123');

    expect(set).not.toHaveBeenCalled();
  });
});
