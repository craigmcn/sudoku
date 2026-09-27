import type { Difficulty } from './generator';
import { db } from './firebase';
import type { Board } from './solver';
import {
  recordPuzzleCompletion,
  recordPuzzleStart,
  recordUserPlay,
} from './stats';

const STORAGE_KEY = 'sudoku-stats-outbox';
// A device that stays offline (or keeps getting rejected) for a very long
// time shouldn't grow localStorage without bound; oldest entries go first.
const MAX_ENTRIES = 200;

export type PendingStat =
  | {
      id: string;
      kind: 'start';
      puzzleId: string;
      difficulty: Difficulty;
      puzzle: Board;
    }
  // The aggregate counter bump and the user's own history entry are queued
  // separately so a retry after one succeeds can't double-count the other.
  | { id: string; kind: 'completion'; puzzleId: string; elapsedMs: number }
  | {
      id: string;
      kind: 'play';
      puzzleId: string;
      difficulty: Difficulty;
      mistakes: number;
      elapsedMs: number;
    };

// Omit distributed over the union, so each variant keeps its own fields.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type NewPendingStat = DistributiveOmit<PendingStat, 'id'>;

export function readOutbox(): PendingStat[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingStat[]) : [];
  } catch (err) {
    console.warn('Failed to read stats outbox:', err);
    return [];
  }
}

function writeOutbox(entries: PendingStat[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    console.warn('Failed to write stats outbox:', err);
  }
}

export function pendingCompletionCount(): number {
  return readOutbox().filter((e) => e.kind === 'play').length;
}

// Every stat goes through here rather than straight to Firestore, so a play
// made offline (or while a request fails) is kept and sent on a later flush
// instead of being lost. No-ops without Firebase, since nothing could ever
// drain it.
export function queueStat(stat: NewPendingStat): void {
  if (!db) return;
  const entry = {
    ...stat,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  } as PendingStat;
  writeOutbox([...readOutbox(), entry].slice(-MAX_ENTRIES));
  void flushStatsOutbox();
}

// A rules rejection or missing doc will fail identically on every retry, so
// it's dropped rather than wedging the queue; anything else (offline,
// network, auth sign-in failing) is assumed transient and retried later.
function isPermanentFailure(err: unknown): boolean {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code: unknown }).code
      : undefined;
  return (
    code === 'permission-denied' ||
    code === 'invalid-argument' ||
    code === 'not-found'
  );
}

async function send(entry: PendingStat): Promise<void> {
  if (entry.kind === 'start') {
    await recordPuzzleStart(
      entry.puzzleId,
      entry.difficulty,
      entry.puzzle,
      entry.puzzleId,
    );
  } else if (entry.kind === 'completion') {
    await recordPuzzleCompletion(entry.puzzleId, entry.elapsedMs);
  } else {
    await recordUserPlay(
      entry.puzzleId,
      entry.difficulty,
      entry.mistakes,
      entry.elapsedMs,
    );
  }
}

let flushing: Promise<void> | null = null;

// Sends queued stats oldest-first, stopping at the first transient failure
// so a completion never overtakes the start that creates its puzzle doc.
// Skipped while the browser reports offline: without Firestore persistence,
// an offline write's promise just hangs until reconnect rather than failing.
export function flushStatsOutbox(): Promise<void> {
  if (flushing) return flushing;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.resolve();
  }

  flushing = (async () => {
    for (const entry of readOutbox()) {
      try {
        await send(entry);
      } catch (err) {
        if (!isPermanentFailure(err)) {
          console.warn('Stats sync paused; will retry:', err);
          return;
        }
        console.warn('Dropping stat rejected by Firestore:', err);
      }
      // Re-read rather than reuse the snapshot: queueStat may have appended
      // new entries while this send was in flight.
      writeOutbox(readOutbox().filter((e) => e.id !== entry.id));
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
