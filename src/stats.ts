import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import {
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import type { Difficulty } from './generator';
import { auth, db } from './firebase';
import { Board } from './solver';

// Firestore rejects nested arrays, so the puzzle grid is stored as 9
// row-strings ('0' for a blank cell) rather than a 9x9 array — see
// firestore.rules and CLAUDE.md.
function boardToRows(board: Board): string[] {
  return board.map((row) => row.map((cell) => cell ?? 0).join(''));
}

// `db` is undefined when Firebase failed to initialize (see src/firebase.ts)
// — narrows the type so callers don't need non-null assertions, and gives a
// clear rejection reason instead of a TypeError deep in the firestore SDK.
function requireDb(): Firestore {
  if (!db) throw new Error('Firebase Firestore is not configured');
  return db;
}

let authReady: Promise<User> | null = null;

// Resolves once a stable (anonymous, for now) Firebase uid exists for this
// browser. Idempotent and safe to call from multiple places — subsequent
// calls reuse the in-flight/resolved promise instead of re-signing-in.
export function ensureAnonymousAuth(): Promise<User> {
  if (!auth) return Promise.reject(new Error('Firebase Auth is not configured'));
  if (authReady) return authReady;

  const authInstance = auth;
  authReady = new Promise<User>((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    unsubscribe = onAuthStateChanged(
      authInstance,
      (user) => {
        if (user) {
          unsubscribe?.();
          resolve(user);
        } else {
          // First emission confirms there's no persisted session (rather
          // than guessing from authInstance.currentUser, which is still
          // null here even when a persisted session exists — restoring it
          // is itself async). Signing in now surfaces the new user through
          // this same listener's next emission.
          signInAnonymously(authInstance).catch((err: unknown) => {
            unsubscribe?.();
            reject(err);
          });
        }
      },
      (err) => {
        unsubscribe?.();
        reject(err);
      },
    );
  });

  // Don't cache a rejection forever — let the next call retry instead of
  // replaying the same failure for the rest of the page session.
  authReady.catch(() => {
    authReady = null;
  });

  return authReady;
}

// Called when a puzzle is first played. Creates the puzzles/{puzzleId} doc
// on first sight (all counters start at 0, per firestore.rules) and then
// bumps timesPlayed by 1 — the create and the increment are separate writes
// so a duplicate generation of the same puzzle naturally falls through to
// just the increment instead of failing to overwrite an existing doc.
export async function recordPuzzleStart(
  puzzleId: string,
  difficulty: Difficulty,
  puzzle: Board,
  solutionHash: string,
): Promise<void> {
  await ensureAnonymousAuth();
  const database = requireDb();
  const ref = doc(database, 'puzzles', puzzleId);
  await runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        difficulty,
        puzzle: boardToRows(puzzle),
        solutionHash,
        timesPlayed: 0,
        totalPlayTimeMs: 0,
        completions: 0,
        isDaily: false,
        createdAt: serverTimestamp(),
      });
    }
  });
  await updateDoc(ref, { timesPlayed: increment(1) });
}

// Called when a puzzle is solved. elapsedMs is the time for this single play
// session — firestore.rules caps each update to +6h to guard against a
// runaway or malicious jump.
export async function recordPuzzleCompletion(puzzleId: string, elapsedMs: number): Promise<void> {
  await ensureAnonymousAuth();
  const ref = doc(requireDb(), 'puzzles', puzzleId);
  await updateDoc(ref, {
    completions: increment(1),
    totalPlayTimeMs: increment(elapsedMs),
  });
}
