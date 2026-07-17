import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from './solver';

const mocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInAnonymously: vi.fn(() => Promise.resolve()),
  doc: vi.fn(() => ({ __ref: true })),
  increment: vi.fn((n: number) => ({ __increment: n })),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => '__serverTimestamp__'),
  updateDoc: vi.fn(),
  auth: { __auth: true } as { __auth: true } | undefined,
  db: { __db: true } as { __db: true } | undefined,
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
  signInAnonymously: mocks.signInAnonymously,
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  increment: mocks.increment,
  runTransaction: mocks.runTransaction,
  serverTimestamp: mocks.serverTimestamp,
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

    await expect(ensureAnonymousAuth()).rejects.toThrow('Firebase Auth is not configured');
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
    await expect(recordPuzzleStart('abc123', 'easy', testBoard, 'abc123')).rejects.toThrow(
      'Firebase Firestore is not configured',
    );

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
