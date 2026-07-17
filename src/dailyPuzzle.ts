import { doc, getDoc, setDoc, type FirestoreError } from 'firebase/firestore';
import { Difficulty, generatePuzzle } from './generator';
import { hashSolution } from './puzzleId';
import { ensurePuzzleDoc, requireDb } from './puzzleDoc';
import { ensureAnonymousAuth } from './stats';
import { Board } from './solver';

// The shared "daily random" pick is constrained to easy/normal/hard —
// expert is deliberately excluded so the one challenge everyone sees by
// default stays approachable (issue #18).
export const DAILY_RANDOM_POOL: readonly Difficulty[] = ['easy', 'normal', 'hard'];

const ALL_DAILY_DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

// FNV-1a, single pass — same technique as puzzleId.ts's hashSolution, just a
// plain string->uint32 hash for deriving a deterministic mulberry32 seed
// from a date+difficulty key, not a dedupe-strength puzzle identity.
export function seedFromString(input: string): number {
  let hash = 0x811c9dc5 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// UTC date string so "today" is the same puzzle for every player regardless
// of their local timezone, rather than rolling over at midnight per-visitor.
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dailySeed(date: string, difficulty: Difficulty): number {
  return seedFromString(`${date}:${difficulty}`);
}

// Deterministically picks one of easy/normal/hard for the shared "daily
// random" challenge — same pick for every player on a given date.
export function dailyRandomDifficulty(date: string): Difficulty {
  const index = seedFromString(`${date}:random`) % DAILY_RANDOM_POOL.length;
  return DAILY_RANDOM_POOL[index];
}

// Fully deterministic from (date, difficulty) via generatePuzzle's seeded
// path — every client computes the byte-identical puzzle locally, so
// gameplay never depends on a network round-trip to Firestore.
export function generateDailyPuzzle(
  date: string,
  difficulty: Difficulty,
): { puzzle: Board; solution: Board } {
  return generatePuzzle(difficulty, dailySeed(date, difficulty));
}

function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as FirestoreError).code === 'permission-denied'
  );
}

// Best-effort bookkeeping only — NOT required for gameplay, since every
// client derives the same puzzle for a given date purely locally (see
// generateDailyPuzzle above). This just ensures the puzzles/{puzzleId} docs
// for today exist (for stats, same as any other puzzle) and that
// dailyPuzzles/{date} points at them, so a future admin/listing feature can
// read "today's puzzles" without regenerating. Called on every daily-button
// click, so the existence check runs first and short-circuits the (real
// backtracking) generation + Firestore transactions once a date is already
// cached — flagged by Copilot on PR #23 as otherwise-redundant work.
// firestore.rules make dailyPuzzles/{date} create-once; if two clients both
// see it missing and race to create it, the loser's create fails
// permission-denied and is treated as success, since the value it would
// have written is identical by construction.
export async function cacheDailyPuzzles(date: string): Promise<void> {
  await ensureAnonymousAuth();

  const database = requireDb();
  const ref = doc(database, 'dailyPuzzles', date);
  const existing = await getDoc(ref);
  if (existing.exists()) return;

  const ids: Record<Difficulty, string> = {} as Record<Difficulty, string>;
  for (const difficulty of ALL_DAILY_DIFFICULTIES) {
    const { puzzle, solution } = generateDailyPuzzle(date, difficulty);
    const puzzleId = hashSolution(solution);
    ids[difficulty] = puzzleId;
    await ensurePuzzleDoc(puzzleId, difficulty, puzzle, puzzleId, { isDaily: true, dailyDate: date });
  }

  try {
    await setDoc(ref, {
      easy: ids.easy,
      normal: ids.normal,
      hard: ids.hard,
      expert: ids.expert,
      random: ids[dailyRandomDifficulty(date)],
    });
  } catch (err) {
    if (!isPermissionDenied(err)) throw err;
  }
}
