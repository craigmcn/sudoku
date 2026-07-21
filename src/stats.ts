import {
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import type { Difficulty } from './generator';
import { auth } from './firebase';
import { ensurePuzzleDoc, requireDb } from './puzzleDoc';
import { Board } from './solver';

let authReady: Promise<User> | null = null;

// Resolves once a stable (anonymous, for now) Firebase uid exists for this
// browser. Idempotent and safe to call from multiple places — subsequent
// calls reuse the in-flight/resolved promise instead of re-signing-in.
export function ensureAnonymousAuth(): Promise<User> {
  if (!auth)
    return Promise.reject(new Error('Firebase Auth is not configured'));
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

// After signOut() (see src/auth.ts), auth.currentUser goes null but this
// module's cached `authReady` still resolves with the old (now-invalid)
// user reference forever, since it's never re-evaluated once resolved.
// Called by signOutUser() so the next ensureAnonymousAuth() call re-runs
// and signs in a fresh anonymous session instead of reusing the stale one.
export function resetAnonymousAuthCache(): void {
  authReady = null;
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
  await ensurePuzzleDoc(puzzleId, difficulty, puzzle, solutionHash);
  const ref = doc(requireDb(), 'puzzles', puzzleId);
  await updateDoc(ref, { timesPlayed: increment(1) });
}

// Called when a puzzle is solved. elapsedMs is the time for this single play
// session — firestore.rules caps each update to +6h to guard against a
// runaway or malicious jump.
export async function recordPuzzleCompletion(
  puzzleId: string,
  elapsedMs: number,
): Promise<void> {
  await ensureAnonymousAuth();
  const ref = doc(requireDb(), 'puzzles', puzzleId);
  await updateDoc(ref, {
    completions: increment(1),
    totalPlayTimeMs: increment(elapsedMs),
  });
}

// Called when a puzzle is solved, alongside recordPuzzleCompletion — that
// function updates the puzzle's aggregate stats, this one records the
// current user's own history for it at users/{uid}/plays/{puzzleId}.
// Overwrites (not accumulates) any prior play of the same puzzle by this
// user, since the doc ID is the puzzleId itself: replaying a puzzle updates
// its history entry to the latest attempt rather than growing a list.
export async function recordUserPlay(
  puzzleId: string,
  difficulty: Difficulty,
  mistakes: number,
  elapsedMs: number,
): Promise<void> {
  const user = await ensureAnonymousAuth();
  const ref = doc(requireDb(), 'users', user.uid, 'plays', puzzleId);
  await setDoc(ref, {
    difficulty,
    mistakes,
    elapsedMs,
    completedAt: serverTimestamp(),
  });
}

export interface UserPlay {
  puzzleId: string;
  difficulty: Difficulty;
  mistakes: number;
  elapsedMs: number;
  completedAt: Date | null;
}

// Reads the current uid's own play history (anonymous or a real linked
// account, see #17/#25), most-recent completion first. Used by the
// stats/profile view (#27); firestore.rules restricts read access to
// request.auth.uid == uid, so this only ever returns the caller's own data.
export async function fetchUserPlays(): Promise<UserPlay[]> {
  const user = await ensureAnonymousAuth();
  const q = query(
    collection(requireDb(), 'users', user.uid, 'plays'),
    orderBy('completedAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data() as {
      difficulty: Difficulty;
      mistakes: number;
      elapsedMs: number;
      completedAt: Timestamp | null;
    };
    return {
      puzzleId: d.id,
      difficulty: data.difficulty,
      mistakes: data.mistakes,
      elapsedMs: data.elapsedMs,
      completedAt: data.completedAt ? data.completedAt.toDate() : null,
    };
  });
}
