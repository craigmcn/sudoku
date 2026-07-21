import type { Difficulty } from './generator';
import type { UserPlay } from './stats';

export interface DifficultySummary {
  completions: number;
  bestMs: number | null;
  avgMs: number | null;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

// One entry per distinct puzzle completed at that difficulty, not per
// attempt — replaying a puzzle overwrites its users/{uid}/plays/{puzzleId}
// doc rather than adding a new one (see #26), so `completions` here counts
// distinct puzzles solved, and best/avg are over each puzzle's latest time.
export function summarizeByDifficulty(
  plays: UserPlay[],
): Record<Difficulty, DifficultySummary> {
  const summary = Object.fromEntries(
    DIFFICULTIES.map((d) => [
      d,
      { completions: 0, bestMs: null, avgMs: null } as DifficultySummary,
    ]),
  ) as Record<Difficulty, DifficultySummary>;

  const totalMs: Record<Difficulty, number> = {
    easy: 0,
    normal: 0,
    hard: 0,
    expert: 0,
  };

  for (const play of plays) {
    const s = summary[play.difficulty];
    s.completions += 1;
    totalMs[play.difficulty] += play.elapsedMs;
    s.bestMs =
      s.bestMs === null ? play.elapsedMs : Math.min(s.bestMs, play.elapsedMs);
  }

  for (const difficulty of DIFFICULTIES) {
    const s = summary[difficulty];
    if (s.completions > 0)
      s.avgMs = Math.round(totalMs[difficulty] / s.completions);
  }

  return summary;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function formatDifficultyLabel(difficulty: Difficulty): string {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}
