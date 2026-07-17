import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { doc, increment, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { Difficulty } from './generator';
import { auth, db } from './firebase';
import { Board } from './solver';

// Firestore rejects nested arrays, so the puzzle grid is stored as 9
// row-strings ('0' for a blank cell) rather than a 9x9 array — see
// firestore.rules and CLAUDE.md.
function boardToRows(board: Board): string[] {
  return board.map((row) => row.map((cell) => cell ?? 0).join(''));
}

let authReady: Promise<User> | null = null;

// Resolves once a stable (anonymous, for now) Firebase uid exists for this
// browser. Idempotent and safe to call from multiple places — subsequent
// calls reuse the in-flight/resolved promise instead of re-signing-in.
export function ensureAnonymousAuth(): Promise<User> {
  if (authReady) return authReady;
  authReady = new Promise<User>((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
        }
      },
      reject,
    );
    if (!auth.currentUser) {
      signInAnonymously(auth).catch(reject);
    }
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
  const ref = doc(db, 'puzzles', puzzleId);
  await runTransaction(db, async (tx) => {
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
  const ref = doc(db, 'puzzles', puzzleId);
  await updateDoc(ref, {
    completions: increment(1),
    totalPlayTimeMs: increment(elapsedMs),
  });
}
