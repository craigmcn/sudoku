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
  auth: { currentUser: null as { uid: string } | null },
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
  auth: mocks.auth,
  db: { __db: true },
}));

const testUser = { uid: 'test-uid' };

const testBoard: Board = Array.from({ length: 9 }, () => Array(9).fill(null));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.auth.currentUser = null;
});

describe('ensureAnonymousAuth', () => {
  it('signs in anonymously and resolves once a user is emitted', async () => {
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      queueMicrotask(() => callback(testUser));
      return vi.fn();
    });

    const { ensureAnonymousAuth } = await import('./stats');
    const user = await ensureAnonymousAuth();

    expect(user).toBe(testUser);
    expect(mocks.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('skips signInAnonymously when a user is already signed in', async () => {
    mocks.auth.currentUser = testUser;
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      queueMicrotask(() => callback(testUser));
      return vi.fn();
    });

    const { ensureAnonymousAuth } = await import('./stats');
    await ensureAnonymousAuth();

    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
  });

  it('reuses the in-flight/resolved promise on subsequent calls', async () => {
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      queueMicrotask(() => callback(testUser));
      return vi.fn();
    });

    const { ensureAnonymousAuth } = await import('./stats');
    await ensureAnonymousAuth();
    await ensureAnonymousAuth();

    expect(mocks.signInAnonymously).toHaveBeenCalledTimes(1);
  });
});

describe('recordPuzzleStart', () => {
  beforeEach(() => {
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      queueMicrotask(() => callback(testUser));
      return vi.fn();
    });
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
});

describe('recordPuzzleCompletion', () => {
  beforeEach(() => {
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      queueMicrotask(() => callback(testUser));
      return vi.fn();
    });
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
