import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {} as object | undefined,
  recordPuzzleStart: vi.fn(),
  recordPuzzleCompletion: vi.fn(),
  recordUserPlay: vi.fn(),
}));

vi.mock('./firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

vi.mock('./stats', () => ({
  recordPuzzleStart: mocks.recordPuzzleStart,
  recordPuzzleCompletion: mocks.recordPuzzleCompletion,
  recordUserPlay: mocks.recordUserPlay,
}));

import {
  flushStatsOutbox,
  pendingCompletionCount,
  queueStat,
  readOutbox,
} from './statsOutbox';

// happy-dom's Window doesn't implement localStorage out of the box (see
// persistedGame.test.ts) — stub it with a small in-memory Storage.
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

const puzzle = Array.from({ length: 9 }, () => Array(9).fill(null));

function queueGame(puzzleId: string): void {
  queueStat({ kind: 'start', puzzleId, difficulty: 'easy', puzzle });
  queueStat({ kind: 'completion', puzzleId, elapsedMs: 1000 });
  queueStat({
    kind: 'play',
    puzzleId,
    difficulty: 'easy',
    mistakes: 2,
    elapsedMs: 1000,
  });
}

function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
}

describe('statsOutbox', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: new MemoryStorage(),
      writable: true,
      configurable: true,
    });
    mocks.db = {};
    mocks.recordPuzzleStart.mockReset().mockResolvedValue(undefined);
    mocks.recordPuzzleCompletion.mockReset().mockResolvedValue(undefined);
    mocks.recordUserPlay.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps everything queued while offline and sends nothing', async () => {
    setOnline(false);
    queueGame('p1');
    await flushStatsOutbox();

    expect(readOutbox().map((e) => e.kind)).toEqual([
      'start',
      'completion',
      'play',
    ]);
    expect(pendingCompletionCount()).toBe(1);
    expect(mocks.recordPuzzleStart).not.toHaveBeenCalled();
  });

  it('sends queued stats in order once back online, then clears them', async () => {
    setOnline(false);
    queueGame('p1');
    setOnline(true);
    await flushStatsOutbox();

    expect(mocks.recordPuzzleStart).toHaveBeenCalledWith(
      'p1',
      'easy',
      puzzle,
      'p1',
    );
    expect(mocks.recordPuzzleCompletion).toHaveBeenCalledWith('p1', 1000);
    expect(mocks.recordUserPlay).toHaveBeenCalledWith('p1', 'easy', 2, 1000);
    expect(mocks.recordPuzzleStart.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordPuzzleCompletion.mock.invocationCallOrder[0],
    );
    expect(readOutbox()).toEqual([]);
  });

  it('stops at a transient failure so later entries stay queued in order', async () => {
    setOnline(false);
    queueGame('p1');
    setOnline(true);
    mocks.recordPuzzleStart.mockRejectedValueOnce(
      Object.assign(new Error('offline'), { code: 'unavailable' }),
    );
    await flushStatsOutbox();

    expect(mocks.recordPuzzleCompletion).not.toHaveBeenCalled();
    expect(readOutbox()).toHaveLength(3);

    await flushStatsOutbox();
    expect(readOutbox()).toEqual([]);
  });

  it('drops an entry Firestore permanently rejects and carries on', async () => {
    setOnline(false);
    queueGame('p1');
    setOnline(true);
    mocks.recordPuzzleCompletion.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'permission-denied' }),
    );
    await flushStatsOutbox();

    expect(mocks.recordUserPlay).toHaveBeenCalledTimes(1);
    expect(readOutbox()).toEqual([]);
  });

  it('does not re-send a completion when only the play write failed', async () => {
    setOnline(false);
    queueGame('p1');
    setOnline(true);
    mocks.recordUserPlay.mockRejectedValueOnce(new Error('network'));
    await flushStatsOutbox();
    await flushStatsOutbox();

    expect(mocks.recordPuzzleCompletion).toHaveBeenCalledTimes(1);
    expect(mocks.recordUserPlay).toHaveBeenCalledTimes(2);
    expect(readOutbox()).toEqual([]);
  });

  it('sends an entry queued while a flush is already in flight', async () => {
    setOnline(true);
    let releaseStart!: () => void;
    mocks.recordPuzzleStart.mockReturnValueOnce(
      new Promise<void>((resolve) => (releaseStart = resolve)),
    );
    queueStat({ kind: 'start', puzzleId: 'p1', difficulty: 'easy', puzzle });
    const inFlight = flushStatsOutbox();
    queueStat({ kind: 'completion', puzzleId: 'p1', elapsedMs: 1000 });
    releaseStart();
    await inFlight;

    expect(mocks.recordPuzzleCompletion).toHaveBeenCalledWith('p1', 1000);
    expect(readOutbox()).toEqual([]);
  });

  it('skips flushing while another tab holds the outbox lock', async () => {
    setOnline(false);
    queueGame('p1');
    setOnline(true);
    const request = vi.fn(
      (_name: string, _opts: object, cb: (lock: null) => unknown) =>
        Promise.resolve(cb(null)),
    );
    vi.stubGlobal('navigator', {
      onLine: true,
      locks: { request },
    });
    await flushStatsOutbox();
    vi.unstubAllGlobals();

    expect(request).toHaveBeenCalled();
    expect(mocks.recordPuzzleStart).not.toHaveBeenCalled();
    expect(readOutbox()).toHaveLength(3);
  });

  it('queues nothing when Firebase is not configured', () => {
    mocks.db = undefined;
    queueGame('p1');
    expect(readOutbox()).toEqual([]);
  });

  it('caps the queue so a long-offline device cannot grow it unbounded', () => {
    setOnline(false);
    for (let i = 0; i < 100; i++) queueGame(`p${i}`);
    const entries = readOutbox();
    expect(entries).toHaveLength(200);
    expect(entries.at(-1)).toMatchObject({ kind: 'play', puzzleId: 'p99' });
  });

  it('survives unparseable storage', () => {
    localStorage.setItem('sudoku-stats-outbox', '{nope');
    expect(readOutbox()).toEqual([]);
  });
});
