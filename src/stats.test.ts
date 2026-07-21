import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from './solver';

const mocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInAnonymously: vi.fn(() => Promise.resolve()),
  collection: vi.fn(() => ({ __collection: true })),
  doc: vi.fn(() => ({ __ref: true })),
  getDocs: vi.fn(),
  increment: vi.fn((n: number) => ({ __increment: n })),
  orderBy: vi.fn((field: string, direction: string) => ({
    __orderBy: [field, direction],
  })),
  query: vi.fn((...args: unknown[]) => ({ __query: args })),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => '__serverTimestamp__'),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  auth: { __auth: true } as { __auth: true } | undefined,
  db: { __db: true } as { __db: true } | undefined,
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
  signInAnonymously: mocks.signInAnonymously,
}));

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  doc: mocks.doc,
  getDocs: mocks.getDocs,
  increment: mocks.increment,
  orderBy: mocks.orderBy,
  query: mocks.query,
  runTransaction: mocks.runTransaction,
  serverTimestamp: mocks.serverTimestamp,
  setDoc: mocks.setDoc,
  updateDoc: mocks.updateDoc,
}));

vi.mock('./firebase', () => ({
  get auth() {
    return mocks.auth;
  },
  get db() {
    return mocks.db;
  },
}));

const testUser = { uid: 'test-uid' };

const testBoard: Board = Array.from({ length: 9 }, () => Array(9).fill(null));

// Simulates a listener that fires once per queued emission, in order, each
// on its own microtask — matching real onAuthStateChanged, which always
// calls back asynchronously (never synchronously within its own call).
function mockAuthEmissions(...emissions: Array<typeof testUser | null>) {
  mocks.onAuthStateChanged.mockImplementation((_auth, next, error) => {
    (async () => {
      for (const emission of emissions) {
        await Promise.resolve();
        next(emission);
      }
    })().catch(error);
    return vi.fn();
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.auth = { __auth: true };
  mocks.db = { __db: true };
});

describe('ensureAnonymousAuth', () => {
  it('rejects immediately when Firebase Auth failed to initialize', async () => {
    mocks.auth = undefined;
    const { ensureAnonymousAuth } = await import('./stats');

    await expect(ensureAnonymousAuth()).rejects.toThrow(
      'Firebase Auth is not configured',
    );
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled();
  });

  it('signs in anonymously when the first emission has no persisted user', async () => {
    mockAuthEmissions(null, testUser);

    const { ensureAnonymousAuth } = await import('./stats');
    const user = await ensureAnonymousAuth();

    expect(user).toBe(testUser);
    expect(mocks.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('resolves with the persisted user without signing in again', async () => {
    mockAuthEmissions(testUser);

    const { ensureAnonymousAuth } = await import('./stats');
    const user = await ensureAnonymousAuth();

    expect(user).toBe(testUser);
    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
  });

  it('reuses the in-flight/resolved promise on subsequent calls', async () => {
    mockAuthEmissions(testUser);

    const { ensureAnonymousAuth } = await import('./stats');
    await ensureAnonymousAuth();
    await ensureAnonymousAuth();

    expect(mocks.onAuthStateChanged).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejection — a later call retries', async () => {
    mocks.onAuthStateChanged.mockImplementationOnce((_auth, _next, error) => {
      queueMicrotask(() => error(new Error('listener error')));
      return vi.fn();
    });

    const { ensureAnonymousAuth } = await import('./stats');
    await expect(ensureAnonymousAuth()).rejects.toThrow('listener error');

    mockAuthEmissions(testUser);
    const user = await ensureAnonymousAuth();

    expect(user).toBe(testUser);
    expect(mocks.onAuthStateChanged).toHaveBeenCalledTimes(2);
  });
});

describe('recordPuzzleStart', () => {
  beforeEach(() => {
    mockAuthEmissions(testUser);
  });

  it('creates the doc when it does not exist, then increments timesPlayed', async () => {
    const set = vi.fn();
    mocks.runTransaction.mockImplementation(async (_db, updateFn) => {
      await updateFn({ get: async () => ({ exists: () => false }), set });
    });

    const { recordPuzzleStart } = await import('./stats');
    await recordPuzzleStart('abc123', 'easy', testBoard, 'abc123');

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
    expect(docData.puzzle).toHaveLength(9);
    expect(docData.puzzle[0]).toBe('000000000');

    expect(mocks.updateDoc).toHaveBeenCalledWith(expect.anything(), {
      timesPlayed: { __increment: 1 },
    });
  });

  it('skips doc creation when it already exists, but still increments timesPlayed', async () => {
    const set = vi.fn();
    mocks.runTransaction.mockImplementation(async (_db, updateFn) => {
      await updateFn({ get: async () => ({ exists: () => true }), set });
    });

    const { recordPuzzleStart } = await import('./stats');
    await recordPuzzleStart('abc123', 'easy', testBoard, 'abc123');

    expect(set).not.toHaveBeenCalled();
    expect(mocks.updateDoc).toHaveBeenCalledWith(expect.anything(), {
      timesPlayed: { __increment: 1 },
    });
  });

  it('rejects without writing when Firestore failed to initialize', async () => {
    mocks.db = undefined;

    const { recordPuzzleStart } = await import('./stats');
    await expect(
      recordPuzzleStart('abc123', 'easy', testBoard, 'abc123'),
    ).rejects.toThrow('Firebase Firestore is not configured');

    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
});

describe('recordPuzzleCompletion', () => {
  beforeEach(() => {
    mockAuthEmissions(testUser);
  });

  it('increments completions and adds elapsed time', async () => {
    const { recordPuzzleCompletion } = await import('./stats');
    await recordPuzzleCompletion('abc123', 90_000);

    expect(mocks.updateDoc).toHaveBeenCalledWith(expect.anything(), {
      completions: { __increment: 1 },
      totalPlayTimeMs: { __increment: 90_000 },
    });
  });
});

describe('recordUserPlay', () => {
  beforeEach(() => {
    mockAuthEmissions(testUser);
  });

  it('writes to users/{uid}/plays/{puzzleId} with the play details', async () => {
    const { recordUserPlay } = await import('./stats');
    await recordUserPlay('abc123', 'hard', 2, 90_000);

    expect(mocks.doc).toHaveBeenCalledWith(
      expect.anything(),
      'users',
      testUser.uid,
      'plays',
      'abc123',
    );
    expect(mocks.setDoc).toHaveBeenCalledWith(expect.anything(), {
      difficulty: 'hard',
      mistakes: 2,
      elapsedMs: 90_000,
      completedAt: '__serverTimestamp__',
    });
  });

  it('overwrites (does not merge) a prior play of the same puzzle', async () => {
    const { recordUserPlay } = await import('./stats');
    await recordUserPlay('abc123', 'easy', 0, 60_000);

    // setDoc called with just (ref, data) — no { merge: true } — so a repeat
    // play of the same puzzle fully replaces the prior attempt's doc.
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    expect(mocks.setDoc.mock.calls[0]).toHaveLength(2);
  });

  it('rejects without writing when Firestore failed to initialize', async () => {
    mocks.db = undefined;

    const { recordUserPlay } = await import('./stats');
    await expect(recordUserPlay('abc123', 'easy', 0, 60_000)).rejects.toThrow(
      'Firebase Firestore is not configured',
    );

    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});

describe('fetchUserPlays', () => {
  beforeEach(() => {
    mockAuthEmissions(testUser);
  });

  function fakeTimestamp(date: Date) {
    return { toDate: () => date };
  }

  it('queries users/{uid}/plays ordered by completedAt descending', async () => {
    mocks.getDocs.mockResolvedValue({ docs: [] });

    const { fetchUserPlays } = await import('./stats');
    await fetchUserPlays();

    expect(mocks.collection).toHaveBeenCalledWith(
      expect.anything(),
      'users',
      testUser.uid,
      'plays',
    );
    expect(mocks.orderBy).toHaveBeenCalledWith('completedAt', 'desc');
  });

  it('maps each doc to a UserPlay, converting the Timestamp to a Date', async () => {
    const completedAt = new Date('2026-07-21T12:00:00Z');
    mocks.getDocs.mockResolvedValue({
      docs: [
        {
          id: 'puzzle-1',
          data: () => ({
            difficulty: 'hard',
            mistakes: 3,
            elapsedMs: 120_000,
            completedAt: fakeTimestamp(completedAt),
          }),
        },
      ],
    });

    const { fetchUserPlays } = await import('./stats');
    const plays = await fetchUserPlays();

    expect(plays).toEqual([
      {
        puzzleId: 'puzzle-1',
        difficulty: 'hard',
        mistakes: 3,
        elapsedMs: 120_000,
        completedAt,
      },
    ]);
  });

  it('falls back to a null completedAt when the field is missing', async () => {
    mocks.getDocs.mockResolvedValue({
      docs: [
        {
          id: 'puzzle-1',
          data: () => ({
            difficulty: 'easy',
            mistakes: 0,
            elapsedMs: 30_000,
            completedAt: null,
          }),
        },
      ],
    });

    const { fetchUserPlays } = await import('./stats');
    const plays = await fetchUserPlays();

    expect(plays[0].completedAt).toBeNull();
  });

  it('rejects without querying when Firestore failed to initialize', async () => {
    mocks.db = undefined;

    const { fetchUserPlays } = await import('./stats');
    await expect(fetchUserPlays()).rejects.toThrow(
      'Firebase Firestore is not configured',
    );

    expect(mocks.getDocs).not.toHaveBeenCalled();
  });
});
