import { Difficulty, GameState } from './game';

const STORAGE_KEY = 'sudoku-saved-game';
// Bump when GameState's shape changes so an old save from a prior schema
// can't be rehydrated into code that no longer expects it.
const SCHEMA_VERSION = 1;
// A save older than this is more likely to confuse a returning player than
// help them, so it's discarded rather than resumed.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PersistedGame {
  version: number;
  savedAt: number;
  difficulty: Difficulty;
  state: GameState;
}

export interface RestoredGame {
  state: GameState;
  difficulty: Difficulty;
}

export function saveGame(state: GameState, difficulty: Difficulty): void {
  if (state.solved) {
    clearSavedGame();
    return;
  }
  const payload: PersistedGame = {
    version: SCHEMA_VERSION,
    savedAt: Date.now(),
    difficulty,
    state,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Failed to save game state:', err);
  }
}

export function loadGame(): RestoredGame | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to read saved game state:', err);
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PersistedGame;
    if (
      parsed.version !== SCHEMA_VERSION ||
      Date.now() - parsed.savedAt > MAX_AGE_MS ||
      parsed.state.solved
    ) {
      clearSavedGame();
      return null;
    }
    return { state: parsed.state, difficulty: parsed.difficulty };
  } catch (err) {
    console.warn('Failed to parse saved game state:', err);
    clearSavedGame();
    return null;
  }
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear saved game state:', err);
  }
}
