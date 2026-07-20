import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, enterNumber, selectCell } from './game';
import { clearSavedGame, loadGame, saveGame } from './persistedGame';

// happy-dom's Window doesn't implement localStorage out of the box (see
// auth.test.ts) — stub it with a small in-memory Storage.
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

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
});

describe('saveGame / loadGame', () => {
  it('round-trips an in-progress game', () => {
    const state = selectCell(createGame('easy', 1), 0, 0);
    saveGame(state);

    const restored = loadGame();

    expect(restored).not.toBeNull();
    expect(restored!.difficulty).toBe('easy');
    expect(restored!.puzzleId).toBe(state.puzzleId);
    expect(restored!.userBoard).toEqual(state.userBoard);
  });

  it('returns null when nothing has been saved', () => {
    expect(loadGame()).toBeNull();
  });

  it('does not persist a solved game, and clears any prior save', () => {
    const state = { ...createGame('easy', 1), solved: true };
    saveGame(createGame('easy', 1)); // seed an unsolved save first
    saveGame(state);

    expect(loadGame()).toBeNull();
  });

  it('discards a save from a different schema version', () => {
    const state = createGame('easy', 1);
    saveGame(state);

    const raw = JSON.parse(localStorage.getItem('sudoku-saved-game')!);
    localStorage.setItem(
      'sudoku-saved-game',
      JSON.stringify({ ...raw, version: raw.version + 1 }),
    );

    expect(loadGame()).toBeNull();
    // The stale entry should be cleaned up, not just ignored.
    expect(localStorage.getItem('sudoku-saved-game')).toBeNull();
  });

  it('discards a save older than the max age', () => {
    const state = createGame('easy', 1);
    saveGame(state);

    const raw = JSON.parse(localStorage.getItem('sudoku-saved-game')!);
    const oneDayMs = 24 * 60 * 60 * 1000;
    localStorage.setItem(
      'sudoku-saved-game',
      JSON.stringify({ ...raw, savedAt: Date.now() - oneDayMs - 1 }),
    );

    expect(loadGame()).toBeNull();
  });

  it('discards a corrupt entry rather than throwing', () => {
    localStorage.setItem('sudoku-saved-game', '{not json');
    expect(loadGame()).toBeNull();
    expect(localStorage.getItem('sudoku-saved-game')).toBeNull();
  });

  it('preserves progress like entered numbers and mistakes', () => {
    let state = createGame('easy', 1);
    const emptyCell = state.userBoard
      .flatMap((row, r) => row.map((v, c) => ({ r, c, v })))
      .find((cell) => cell.v === null && !state.given[cell.r][cell.c])!;
    state = selectCell(state, emptyCell.r, emptyCell.c);
    state = enterNumber(state, 1);
    saveGame(state);

    const restored = loadGame()!;
    expect(restored.mistakes).toBe(state.mistakes);
    expect(restored.userBoard).toEqual(state.userBoard);
  });

  it('does not persist the undo history', () => {
    let state = createGame('easy', 1);
    const emptyCell = state.userBoard
      .flatMap((row, r) => row.map((v, c) => ({ r, c, v })))
      .find((cell) => cell.v === null && !state.given[cell.r][cell.c])!;
    state = selectCell(state, emptyCell.r, emptyCell.c);
    state = enterNumber(state, 1);
    expect(state.history.length).toBeGreaterThan(0);

    saveGame(state);

    expect(loadGame()!.history).toEqual([]);
  });
});

describe('clearSavedGame', () => {
  it('removes a saved game', () => {
    saveGame(createGame('easy', 1));
    expect(loadGame()).not.toBeNull();

    clearSavedGame();

    expect(loadGame()).toBeNull();
  });
});
