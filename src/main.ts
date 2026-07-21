import {
  GameState,
  Difficulty,
  createGame,
  selectCell,
  enterNumber,
  eraseCell,
  undoMove,
  toggleNotesMode,
  applyHint,
  togglePause,
  getConflicts,
} from './game';
import {
  recordPuzzleCompletion,
  recordPuzzleStart,
  recordUserPlay,
} from './stats';
import { loadGame, saveGame } from './persistedGame';
import {
  cacheDailyPuzzles,
  dailyRandomDifficulty,
  dailySeed,
  todayUtc,
} from './dailyPuzzle';
import {
  completeEmailLinkSignInIfPresent,
  onAuthChange,
  sendSignInLink,
  signInWithGoogle,
  signOutUser,
} from './auth';
import type { User as FirebaseUser } from 'firebase/auth';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const boardEl = document.getElementById('board')!;
const timerEl = document.getElementById('timer')!;
const loadingEl = document.getElementById('loading')!;
const overlayEl = document.getElementById('overlay')!;
const pauseOverlayEl = document.getElementById('pauseOverlay')!;
const solveStatsEl = document.getElementById('solveStats')!;
const mistakesEl = document.getElementById('mistakes')!;
const btnUndo = document.getElementById('btnUndo')!;
const btnErase = document.getElementById('btnErase')!;
const btnNotes = document.getElementById('btnNotes')!;
const btnHint = document.getElementById('btnHint')!;
const btnPause = document.getElementById('btnPause')! as HTMLButtonElement;
const btnResume = document.getElementById('btnResume')!;
const btnNewGame = document.getElementById('btnNewGame')!;
const btnPlayAgain = document.getElementById('btnPlayAgain')!;
const numpadEl = document.getElementById('numpad')!;
const btnDaily = document.getElementById('btnDaily')!;
const btnDailyRandom = document.getElementById('btnDailyRandom')!;
const btnSignIn = document.getElementById('btnSignIn')!;
const signedInInfo = document.getElementById('signedInInfo')!;
const signedInLabel = document.getElementById('signedInLabel')!;
const btnSignOut = document.getElementById('btnSignOut')!;
const signInOverlay = document.getElementById('signInOverlay')!;
const btnGoogleSignIn = document.getElementById('btnGoogleSignIn')!;
const emailLinkInput = document.getElementById(
  'emailLinkInput',
)! as HTMLInputElement;
const btnEmailLinkSignIn = document.getElementById('btnEmailLinkSignIn')!;
const signInStatusEl = document.getElementById('signInStatus')!;
const btnCloseSignIn = document.getElementById('btnCloseSignIn')!;

// ── State ────────────────────────────────────────────────────────────────────

let state: GameState | null = null;
let difficulty: Difficulty = 'easy';
// Set for a daily puzzle (see startDailyGame); startNewGame passes it to
// createGame so the puzzle is reproduced deterministically instead of
// randomly generated. Cleared by any action that should give a fresh
// random puzzle (regular difficulty pick, New Game, Play Again).
let activeSeed: number | undefined;
// Bumped on every startNewGame() call; each call captures its own value and
// checks it again after the loading yield, so an overlapping older call
// (e.g. two quick clicks across difficulty/daily buttons) bails out instead
// of clobbering a newer call's state with a stale puzzle.
let gameGeneration = 0;
let timerInterval: ReturnType<typeof setInterval> | null = null;
// Guards against recordPuzzleCompletion firing more than once for the same
// solve — render() can run again after `solved` flips true (e.g. further
// keydown events before handlers notice), but handleVictory should only
// report the completion the first time.
let completionRecorded = false;

// ── Cell elements ─────────────────────────────────────────────────────────────

const cellEls: HTMLDivElement[][] = [];

function initBoard(): void {
  boardEl.innerHTML = '';
  cellEls.length = 0;

  for (let row = 0; row < 9; row++) {
    const rowEls: HTMLDivElement[] = [];
    for (let col = 0; col < 9; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);

      // Thick box borders
      if (col % 3 === 2 && col < 8) cell.classList.add('box-right');
      if (row % 3 === 2 && row < 8) cell.classList.add('box-bottom');

      // Value span
      const valueSpan = document.createElement('span');
      valueSpan.className = 'cell-value';
      cell.appendChild(valueSpan);

      // Notes grid (9 spans, one per digit)
      const notesDiv = document.createElement('div');
      notesDiv.className = 'cell-notes';
      for (let n = 1; n <= 9; n++) {
        const noteSpan = document.createElement('span');
        noteSpan.className = 'note';
        noteSpan.dataset.num = String(n);
        notesDiv.appendChild(noteSpan);
      }
      cell.appendChild(notesDiv);

      cell.addEventListener('click', () => handleCellClick(row, col));
      boardEl.appendChild(cell);
      rowEls.push(cell);
    }
    cellEls.push(rowEls);
  }
}

function initNumpad(): void {
  numpadEl.innerHTML = '';
  for (let n = 1; n <= 9; n++) {
    const btn = document.createElement('button');
    btn.className = 'num-btn';
    btn.textContent = String(n);
    btn.dataset.num = String(n);
    btn.addEventListener('click', () => handleNumInput(n));
    numpadEl.appendChild(btn);
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render(): void {
  if (!state) return;

  saveGame(state);

  const conflicts = getConflicts(state);
  const sel = state.selected;
  const selVal = sel ? state.userBoard[sel.row][sel.col] : null;

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const cell = cellEls[row][col];
      const val = state.userBoard[row][col];
      const notesMask = state.notes[row][col];
      const key = `${row},${col}`;

      // Reset classes (keep structural ones)
      cell.className = 'cell';
      if (col % 3 === 2 && col < 8) cell.classList.add('box-right');
      if (row % 3 === 2 && row < 8) cell.classList.add('box-bottom');

      // Given
      if (state.given[row][col]) cell.classList.add('given');

      // Selection and peers
      if (sel) {
        if (sel.row === row && sel.col === col) {
          cell.classList.add('selected');
        } else {
          const samePeer =
            sel.row === row ||
            sel.col === col ||
            (Math.floor(sel.row / 3) === Math.floor(row / 3) &&
              Math.floor(sel.col / 3) === Math.floor(col / 3));
          if (samePeer) cell.classList.add('peer');
        }

        // Highlight same number
        if (selVal !== null && val === selVal) {
          cell.classList.add('same-num');
        }
      }

      // Conflict
      if (conflicts.has(key)) cell.classList.add('conflict');

      // Value or notes
      const valueSpan = cell.querySelector('.cell-value') as HTMLSpanElement;
      const notesDiv = cell.querySelector('.cell-notes') as HTMLDivElement;

      if (val !== null) {
        valueSpan.textContent = String(val);
        cell.classList.add('has-value');
      } else {
        valueSpan.textContent = '';
      }

      if (notesMask !== 0 && val === null) {
        cell.classList.add('has-notes');
        notesDiv.querySelectorAll('.note').forEach((span) => {
          const num = parseInt((span as HTMLElement).dataset.num!);
          (span as HTMLElement).textContent =
            (notesMask >> (num - 1)) & 1 ? String(num) : '';
        });
      } else {
        notesDiv.querySelectorAll('.note').forEach((span) => {
          (span as HTMLElement).textContent = '';
        });
      }
    }
  }

  // Notes mode button highlight
  btnNotes.classList.toggle('active', state.notesMode);

  // Pause button enabled once the timer has started and the puzzle isn't solved
  btnPause.disabled = !state.started || state.solved;
  btnPause.querySelector('i')!.className = state.paused
    ? 'fa-sharp fa-light fa-play'
    : 'fa-sharp fa-light fa-pause';
  btnPause.setAttribute(
    'aria-label',
    state.paused ? 'Resume timer' : 'Pause timer',
  );

  // Mistakes
  mistakesEl.textContent = `Mistakes: ${state.mistakes}`;

  // Numpad highlight (dim fully-placed digits)
  const counts: number[] = Array(10).fill(0);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (state.userBoard[r][c]) counts[state.userBoard[r][c]!]++;

  numpadEl.querySelectorAll('.num-btn').forEach((btn) => {
    const n = parseInt((btn as HTMLElement).dataset.num!);
    (btn as HTMLElement).classList.toggle('completed', counts[n] >= 9);
    (btn as HTMLElement).classList.toggle('selected-num', selVal === n);
  });

  if (state.solved) handleVictory();
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function startTimer(): void {
  stopTimer();
  timerInterval = setInterval(() => {
    if (!state || state.solved) return;
    state = {
      ...state,
      elapsed: Math.floor((Date.now() - state.startTime) / 1000),
    };
    renderTimer();
  }, 1000);
}

function stopTimer(): void {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function renderTimer(): void {
  if (!state) return;
  const s = state.elapsed;
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
}

// Kicks off the timer the moment `started` first flips true (first digit
// entered or first hint applied), regardless of which action triggered it.
function startTimerIfJustStarted(wasStarted: boolean): void {
  if (!state || wasStarted || !state.started) return;
  state = { ...state, startTime: Date.now(), elapsed: 0 };
  startTimer();
}

// ── Game flow ─────────────────────────────────────────────────────────────────

async function startNewGame(): Promise<void> {
  const myGeneration = ++gameGeneration;

  stopTimer();
  overlayEl.classList.add('hidden');
  pauseOverlayEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  // Yield to browser so loading UI renders before sync generation work
  await new Promise((r) => setTimeout(r, 30));

  // A newer startNewGame() call started while this one was yielding —
  // let it win instead of overwriting its state with a stale puzzle.
  if (myGeneration !== gameGeneration) return;

  state = createGame(difficulty, activeSeed);
  completionRecorded = false;
  loadingEl.classList.add('hidden');
  timerEl.textContent = '00:00';
  // Timer stays idle until the first cell is filled — see handleNumInput
  render();

  recordPuzzleStart(
    state.puzzleId,
    state.difficulty,
    state.puzzle,
    state.puzzleId,
  ).catch((err: unknown) =>
    console.warn('Failed to record puzzle start:', err),
  );
}

// Rehydrates a saved in-progress game (see src/persistedGame.ts) instead of
// generating a new puzzle — used at boot, e.g. after a backgrounded tab gets
// reloaded from scratch by the browser. A game that had already started is
// always restored paused, since the elapsed time was last saved whenever the
// tab was backgrounded/hidden and jumping straight back into a live timer
// without the player's say-so would be surprising.
function tryRestoreGame(): boolean {
  const saved = loadGame();
  if (!saved) return false;

  difficulty = saved.difficulty;
  activeSeed = undefined;
  state = saved.started ? { ...saved, paused: true } : saved;
  completionRecorded = false;

  loadingEl.classList.add('hidden');
  setActiveDiffButton(difficulty);
  btnDaily.classList.remove('active');
  btnDailyRandom.classList.remove('active');
  render();
  renderTimer();

  if (state.paused) {
    pauseOverlayEl.classList.remove('hidden');
  } else if (state.started) {
    startTimer();
  }

  return true;
}

function setActiveDiffButton(target: Difficulty): void {
  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.classList.toggle(
      'active',
      (btn as HTMLElement).dataset.diff === target,
    );
  });
}

// Starts today's puzzle for `targetDifficulty` — deterministic, so every
// player gets the identical puzzle. `dailyButton` is the button that should
// show as active (Today's Puzzle vs. Daily Random pick a difficulty
// differently, but both land here).
function startDailyGame(
  targetDifficulty: Difficulty,
  dailyButton: HTMLElement,
): void {
  const date = todayUtc();
  difficulty = targetDifficulty;
  activeSeed = dailySeed(date, targetDifficulty);
  setActiveDiffButton(targetDifficulty);
  btnDaily.classList.toggle('active', dailyButton === btnDaily);
  btnDailyRandom.classList.toggle('active', dailyButton === btnDailyRandom);
  startNewGame();

  // Best-effort bookkeeping — see cacheDailyPuzzles for why this is never
  // required for the puzzle above to be correct.
  cacheDailyPuzzles(date).catch((err: unknown) =>
    console.warn('Failed to cache daily puzzles:', err),
  );
}

function handleVictory(): void {
  stopTimer();
  const elapsed = state!.elapsed;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  solveStatsEl.textContent = `${diffLabel} · ${mm}:${ss} · ${state!.mistakes} mistake${state!.mistakes !== 1 ? 's' : ''}`;
  overlayEl.classList.remove('hidden');

  if (!completionRecorded) {
    completionRecorded = true;
    recordPuzzleCompletion(state!.puzzleId, elapsed * 1000).catch(
      (err: unknown) =>
        console.warn('Failed to record puzzle completion:', err),
    );
    recordUserPlay(
      state!.puzzleId,
      state!.difficulty,
      state!.mistakes,
      elapsed * 1000,
    ).catch((err: unknown) => console.warn('Failed to record user play:', err));
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function renderAuthState(user: FirebaseUser | null): void {
  const signedIn = !!user && !user.isAnonymous;
  btnSignIn.classList.toggle('hidden', signedIn);
  signedInInfo.classList.toggle('hidden', !signedIn);
  if (signedIn) {
    signedInLabel.textContent = user!.displayName || user!.email || 'Signed in';
  }
}

function openSignInOverlay(): void {
  signInStatusEl.textContent = '';
  emailLinkInput.value = '';
  signInOverlay.classList.remove('hidden');
}

function closeSignInOverlay(): void {
  signInOverlay.classList.add('hidden');
}

async function handleGoogleSignIn(): Promise<void> {
  signInStatusEl.textContent = '';
  try {
    await signInWithGoogle();
    closeSignInOverlay();
  } catch (err) {
    signInStatusEl.textContent = 'Sign-in failed. Please try again.';
    console.warn('Google sign-in failed:', err);
  }
}

async function handleEmailLinkSignIn(): Promise<void> {
  const email = emailLinkInput.value.trim();
  if (!email) {
    signInStatusEl.textContent = 'Enter an email address.';
    return;
  }
  signInStatusEl.textContent = '';
  try {
    await sendSignInLink(email);
    signInStatusEl.textContent = 'Check your email for a sign-in link.';
  } catch (err) {
    signInStatusEl.textContent =
      'Could not send sign-in link. Please try again.';
    console.warn('Failed to send sign-in link:', err);
  }
}

async function handleSignOut(): Promise<void> {
  try {
    await signOutUser();
  } catch (err) {
    console.warn('Sign-out failed:', err);
  }
}

// ── Event handlers ────────────────────────────────────────────────────────────

function handleCellClick(row: number, col: number): void {
  if (!state || state.solved || state.paused) return;
  state = selectCell(state, row, col);
  render();
}

function handleNumInput(num: number): void {
  if (!state || state.solved || state.paused) return;
  const wasStarted = state.started;
  state = enterNumber(state, num);
  startTimerIfJustStarted(wasStarted);
  render();
}

function handlePauseToggle(): void {
  if (!state || !state.started || state.solved) return;
  state = togglePause(state);
  if (state.paused) {
    stopTimer();
    pauseOverlayEl.classList.remove('hidden');
  } else {
    pauseOverlayEl.classList.add('hidden');
    startTimer();
  }
  render();
}

function handleKeydown(e: KeyboardEvent): void {
  if (!state || state.solved) return;

  if (e.key === 'p' || e.key === 'P') {
    handlePauseToggle();
    return;
  }

  if (state.paused) return;

  if (e.key >= '1' && e.key <= '9') {
    handleNumInput(parseInt(e.key));
    return;
  }

  if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
    state = eraseCell(state);
    render();
    return;
  }

  if (e.key === 'n' || e.key === 'N') {
    state = toggleNotesMode(state);
    render();
    return;
  }

  // Arrow key navigation
  const sel = state.selected;
  if (!sel) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      state = selectCell(state, 0, 0);
      render();
    }
    return;
  }

  let { row, col } = sel;
  switch (e.key) {
    case 'ArrowUp':
      row = Math.max(0, row - 1);
      break;
    case 'ArrowDown':
      row = Math.min(8, row + 1);
      break;
    case 'ArrowLeft':
      col = Math.max(0, col - 1);
      break;
    case 'ArrowRight':
      col = Math.min(8, col + 1);
      break;
    default:
      return;
  }
  e.preventDefault();
  state = { ...state, selected: { row, col } };
  render();
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init(): void {
  initBoard();
  initNumpad();

  // Difficulty buttons — picking one always starts a fresh random puzzle,
  // leaving daily mode if it was active.
  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = (btn as HTMLElement).dataset.diff as Difficulty;
      setActiveDiffButton(target);
      btnDaily.classList.remove('active');
      btnDailyRandom.classList.remove('active');
      difficulty = target;
      activeSeed = undefined;
      startNewGame();
    });
  });

  btnDaily.addEventListener('click', () =>
    startDailyGame(difficulty, btnDaily),
  );
  btnDailyRandom.addEventListener('click', () =>
    startDailyGame(dailyRandomDifficulty(todayUtc()), btnDailyRandom),
  );

  // New Game / Play Again always start a fresh random puzzle, matching
  // pre-daily-puzzle behavior, even if a daily puzzle was active.
  btnNewGame.addEventListener('click', () => {
    btnDaily.classList.remove('active');
    btnDailyRandom.classList.remove('active');
    activeSeed = undefined;
    startNewGame();
  });
  btnPlayAgain.addEventListener('click', () => {
    btnDaily.classList.remove('active');
    btnDailyRandom.classList.remove('active');
    activeSeed = undefined;
    startNewGame();
  });

  btnUndo.addEventListener('click', () => {
    if (!state || state.paused) return;
    state = undoMove(state);
    render();
  });

  btnErase.addEventListener('click', () => {
    if (!state || state.paused) return;
    state = eraseCell(state);
    render();
  });

  btnNotes.addEventListener('click', () => {
    if (!state || state.paused) return;
    state = toggleNotesMode(state);
    render();
  });

  btnHint.addEventListener('click', () => {
    if (!state || state.paused) return;
    const wasStarted = state.started;
    state = applyHint(state);
    startTimerIfJustStarted(wasStarted);
    render();
  });

  btnPause.addEventListener('click', () => handlePauseToggle());
  btnResume.addEventListener('click', () => handlePauseToggle());

  document.addEventListener('keydown', handleKeydown);

  // The timer's setInterval tick updates `state.elapsed` without calling
  // render() (see startTimer), so an idle-but-ticking game's saved elapsed
  // time could otherwise lag behind by up to a second. Save explicitly at
  // the moments a backgrounded/killed tab is most likely to strike.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state) saveGame(state);
  });
  window.addEventListener('pagehide', () => {
    if (state) saveGame(state);
  });

  btnSignIn.addEventListener('click', openSignInOverlay);
  btnCloseSignIn.addEventListener('click', closeSignInOverlay);
  btnGoogleSignIn.addEventListener('click', () => handleGoogleSignIn());
  btnEmailLinkSignIn.addEventListener('click', () => handleEmailLinkSignIn());
  btnSignOut.addEventListener('click', () => handleSignOut());

  onAuthChange(renderAuthState);
  // Completes a passwordless sign-in if the page was just opened from an
  // emailed link (see src/auth.ts) — a no-op otherwise. renderAuthState
  // above already picks up the resulting signed-in state via onAuthChange,
  // so nothing further is needed here on success.
  completeEmailLinkSignInIfPresent().catch((err: unknown) =>
    console.warn('Failed to complete email-link sign-in:', err),
  );

  if (!tryRestoreGame()) startNewGame();
}

init();
