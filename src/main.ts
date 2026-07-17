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
import { recordPuzzleCompletion, recordPuzzleStart } from './stats';

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

// ── State ────────────────────────────────────────────────────────────────────

let state: GameState | null = null;
let difficulty: Difficulty = 'easy';
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
        notesDiv.querySelectorAll('.note').forEach(span => {
          const num = parseInt((span as HTMLElement).dataset.num!);
          (span as HTMLElement).textContent = (notesMask >> (num - 1)) & 1 ? String(num) : '';
        });
      } else {
        notesDiv.querySelectorAll('.note').forEach(span => {
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
  btnPause.setAttribute('aria-label', state.paused ? 'Resume timer' : 'Pause timer');

  // Mistakes
  mistakesEl.textContent = `Mistakes: ${state.mistakes}`;

  // Numpad highlight (dim fully-placed digits)
  const counts: number[] = Array(10).fill(0);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (state.userBoard[r][c]) counts[state.userBoard[r][c]!]++;

  numpadEl.querySelectorAll('.num-btn').forEach(btn => {
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
    state = { ...state, elapsed: Math.floor((Date.now() - state.startTime) / 1000) };
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
  stopTimer();
  overlayEl.classList.add('hidden');
  pauseOverlayEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  // Yield to browser so loading UI renders before sync generation work
  await new Promise(r => setTimeout(r, 30));

  state = createGame(difficulty);
  completionRecorded = false;
  loadingEl.classList.add('hidden');
  timerEl.textContent = '00:00';
  // Timer stays idle until the first cell is filled — see handleNumInput
  render();

  recordPuzzleStart(state.puzzleId, state.difficulty, state.puzzle, state.puzzleId).catch(
    (err: unknown) => console.warn('Failed to record puzzle start:', err),
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
    recordPuzzleCompletion(state!.puzzleId, elapsed * 1000).catch((err: unknown) =>
      console.warn('Failed to record puzzle completion:', err),
    );
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
    case 'ArrowUp':    row = Math.max(0, row - 1); break;
    case 'ArrowDown':  row = Math.min(8, row + 1); break;
    case 'ArrowLeft':  col = Math.max(0, col - 1); break;
    case 'ArrowRight': col = Math.min(8, col + 1); break;
    default: return;
  }
  e.preventDefault();
  state = { ...state, selected: { row, col } };
  render();
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init(): void {
  initBoard();
  initNumpad();

  // Difficulty buttons
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      difficulty = (btn as HTMLElement).dataset.diff as Difficulty;
      startNewGame();
    });
  });

  btnNewGame.addEventListener('click', () => startNewGame());
  btnPlayAgain.addEventListener('click', () => startNewGame());

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

  startNewGame();
}

init();
