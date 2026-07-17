import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import type { Difficulty } from './generator';
import { db } from './firebase';
import { Board } from './solver';

// Firestore rejects nested arrays, so the puzzle grid is stored as 9
// row-strings ('0' for a blank cell) rather than a 9x9 array — see
// firestore.rules and CLAUDE.md.
export function boardToRows(board: Board): string[] {
  return board.map((row) => row.map((cell) => cell ?? 0).join(''));
}

// `db` is undefined when Firebase failed to initialize (see src/firebase.ts)
// — narrows the type so callers don't need non-null assertions, and gives a
// clear rejection reason instead of a TypeError deep in the firestore SDK.
export function requireDb(): Firestore {
  if (!db) throw new Error('Firebase Firestore is not configured');
  return db;
}

export interface EnsurePuzzleDocOptions {
  isDaily?: boolean;
  dailyDate?: string;
}

// Creates puzzles/{puzzleId} on first sight (all counters start at 0, per
// firestore.rules) and no-ops if it already exists. Shared by
// recordPuzzleStart (src/stats.ts) and the daily-puzzle cache
// (src/dailyPuzzle.ts) — both just need "this puzzle's doc exists" before
// doing their own follow-up writes (counter increments, the dailyPuzzles
// pointer doc).
export async function ensurePuzzleDoc(
  puzzleId: string,
  difficulty: Difficulty,
  puzzle: Board,
  solutionHash: string,
  options: EnsurePuzzleDocOptions = {},
): Promise<void> {
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
        isDaily: options.isDaily ?? false,
        ...(options.dailyDate ? { dailyDate: options.dailyDate } : {}),
        createdAt: serverTimestamp(),
      });
    }
  });
}
