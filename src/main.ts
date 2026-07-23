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
  fetchUserPlays,
  recordPuzzleCompletion,
  recordPuzzleStart,
  recordUserPlay,
  type UserPlay,
} from './stats';
import {
  formatDifficultyLabel,
  formatElapsed,
  summarizeByDifficulty,
} from './statsView';
import { loadGame, saveGame } from './persistedGame';
import {
  cacheDailyPuzzles,
  dailyPuzzleId,
  dailyRandomDifficulty,
  dailySeed,
  MIN_CALENDAR_DATE,
  todayUtc,
} from './dailyPuzzle';
import {
  buildCalendarMonth,
  canGoToNextMonth,
  canGoToPreviousMonth,
  difficultiesWithCompletions,
  formatCalendarDayLabel,
  formatMonthLabel,
  isDateSelectable,
  selectableDatesInMonth,
  shiftMonth,
  type CalendarDay,
} from './calendarView';
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
const signedInAvatarImg = document.getElementById(
  'signedInAvatarImg',
)! as HTMLImageElement;
const signedInAvatarIcon = document.getElementById('signedInAvatarIcon')!;
const btnSignOut = document.getElementById('btnSignOut')!;
const signInOverlay = document.getElementById('signInOverlay')!;
const btnGoogleSignIn = document.getElementById('btnGoogleSignIn')!;
const emailLinkInput = document.getElementById(
  'emailLinkInput',
)! as HTMLInputElement;
const btnEmailLinkSignIn = document.getElementById('btnEmailLinkSignIn')!;
const signInStatusEl = document.getElementById('signInStatus')!;
const btnCloseSignIn = document.getElementById('btnCloseSignIn')!;
const btnStats = document.getElementById('btnStats')!;
const statsOverlay = document.getElementById('statsOverlay')!;
const statsContent = document.getElementById('statsContent')!;
const btnMenu = document.getElementById('btnMenu')! as HTMLButtonElement;
const btnCloseMenu = document.getElementById('btnCloseMenu')! as HTMLButtonElement;
const secondaryNav = document.getElementById('secondaryNav')!;
const drawerBackdrop = document.getElementById('drawerBackdrop')!;
// Must stay in sync with the drawer breakpoint in public/styles.css — used
// to decide whether the closed drawer should be `inert` (off-canvas, mobile
// mode) or left interactive (a normal inline row, desktop mode).
const drawerMediaQuery = window.matchMedia(
  '(max-width: 32.5rem), (max-height: 50rem)',
);
const btnCloseStats = document.getElementById('btnCloseStats')!;
const btnCalendar = document.getElementById('btnCalendar')!;
const calendarOverlay = document.getElementById('calendarOverlay')!;
const calendarContent = document.getElementById('calendarContent')!;
const calendarMonthLabel = document.getElementById('calendarMonthLabel')!;
const btnCalendarPrev = document.getElementById(
  'btnCalendarPrev',
)! as HTMLButtonElement;
const btnCalendarNext = document.getElementById(
  'btnCalendarNext',
)! as HTMLButtonElement;
const btnCloseCalendar = document.getElementById('btnCloseCalendar')!;

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

// Starts `date`'s daily puzzle for `targetDifficulty` — deterministic, so
// every player gets the identical puzzle for that date. `dailyButton` is the
// nav button that should show as active; a calendar-day click passes its own
// button element, so this comparison naturally evaluates false for both
// #btnDaily and #btnDailyRandom, correctly clearing both.
function startDailyGame(
  targetDifficulty: Difficulty,
  date: string,
  dailyButton: HTMLElement,
): void {
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

// ── Mobile drawer ─────────────────────────────────────────────────────────────
// #secondaryNav (daily puzzle + stats/account) becomes a slide-in drawer at
// mobile widths (see #35) — the hamburger/backdrop/Escape wiring below is a
// no-op visually at desktop widths since .menu-btn is hidden there and
// nothing ever calls openDrawer().

function openDrawer(): void {
  secondaryNav.classList.add('open');
  secondaryNav.inert = false;
  secondaryNav.setAttribute('role', 'dialog');
  secondaryNav.setAttribute('aria-modal', 'true');
  drawerBackdrop.classList.remove('hidden');
  btnMenu.setAttribute('aria-expanded', 'true');
  btnCloseMenu.focus();
}

// Called from every "the drawer should no longer be open" site — action
// buttons inside it (which move focus/context elsewhere themselves), the
// resize listener, and dismissDrawer() below. Doesn't touch focus itself;
// callers that are dismissing the drawer without taking another action
// (close button, backdrop, Escape) use dismissDrawer() instead so focus
// returns to #btnMenu rather than being left wherever it was.
function closeDrawer(): void {
  secondaryNav.classList.remove('open');
  // Only inert while actually off-canvas (drawer/mobile mode) — on desktop
  // this is a normal inline row and must stay interactive regardless of
  // the (there-meaningless) open/closed state.
  secondaryNav.inert = drawerMediaQuery.matches;
  secondaryNav.removeAttribute('role');
  secondaryNav.removeAttribute('aria-modal');
  drawerBackdrop.classList.add('hidden');
  btnMenu.setAttribute('aria-expanded', 'false');
}

function dismissDrawer(): void {
  closeDrawer();
  btnMenu.focus();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function renderAuthState(user: FirebaseUser | null): void {
  const signedIn = !!user && !user.isAnonymous;
  btnSignIn.classList.toggle('hidden', signedIn);
  signedInInfo.classList.toggle('hidden', !signedIn);
  if (signedIn) {
    const label = user!.displayName || user!.email || 'Signed in';
    signedInLabel.textContent = label;
    // Fallback accessible name for the icon-fallback case (no photoURL),
    // where nothing else in signedInInfo carries the identity when the
    // text label is visually hidden (desktop, see public/styles.css). Less
    // reliable than a real element's accessible name since signedInInfo is
    // a plain, non-focusable <div> — when a real photo is shown, the img's
    // own `alt` below is the primary/more reliable source instead.
    signedInInfo.setAttribute('aria-label', label);
    if (user!.photoURL) {
      signedInAvatarImg.src = user!.photoURL;
      signedInAvatarImg.alt = label;
      signedInAvatarImg.classList.remove('hidden');
      signedInAvatarIcon.classList.add('hidden');
    } else {
      signedInAvatarImg.classList.add('hidden');
      signedInAvatarIcon.classList.remove('hidden');
    }
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

// ── Stats ─────────────────────────────────────────────────────────────────────

const RECENT_PLAYS_LIMIT = 10;
const DISPLAY_DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];
// Bumped on every openStatsOverlay()/closeStatsOverlay() call, mirroring
// startNewGame()'s gameGeneration guard: each fetchUserPlays() call captures
// its own value and checks it again after the await, so an overlapping
// older call (rapid re-clicks, or a close while a fetch is in flight) bails
// out instead of clobbering a newer render with stale data.
let statsRequestId = 0;

function renderStatsMessage(text: string, className: string): void {
  statsContent.innerHTML = '';
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  statsContent.appendChild(p);
}

function renderStatsData(plays: UserPlay[]): void {
  statsContent.innerHTML = '';

  if (plays.length === 0) {
    renderStatsMessage(
      'No completed puzzles yet — solve one to see your stats here.',
      'stats-empty',
    );
    return;
  }

  const summary = summarizeByDifficulty(plays);

  const grid = document.createElement('div');
  grid.className = 'stats-difficulty-grid';
  for (const difficulty of DISPLAY_DIFFICULTIES) {
    const s = summary[difficulty];
    const card = document.createElement('div');
    card.className = 'stats-difficulty-card';

    const heading = document.createElement('h3');
    heading.textContent = formatDifficultyLabel(difficulty);
    card.appendChild(heading);

    const completed = document.createElement('p');
    completed.textContent = `${s.completions} completed`;
    card.appendChild(completed);

    if (s.completions > 0) {
      const best = document.createElement('p');
      best.textContent = `Best: ${formatElapsed(s.bestMs!)}`;
      card.appendChild(best);

      const avg = document.createElement('p');
      avg.textContent = `Avg: ${formatElapsed(s.avgMs!)}`;
      card.appendChild(avg);
    }

    grid.appendChild(card);
  }
  statsContent.appendChild(grid);

  const recentSection = document.createElement('div');
  recentSection.className = 'stats-section';
  const recentHeading = document.createElement('h3');
  recentHeading.textContent = 'Recent games';
  recentSection.appendChild(recentHeading);

  const list = document.createElement('ul');
  list.className = 'stats-recent-list';
  for (const play of plays.slice(0, RECENT_PLAYS_LIMIT)) {
    const item = document.createElement('li');
    item.className = 'stats-recent-item';

    const label = document.createElement('span');
    const mistakeLabel = `${play.mistakes} mistake${play.mistakes !== 1 ? 's' : ''}`;
    label.textContent = `${formatDifficultyLabel(play.difficulty)} · ${formatElapsed(play.elapsedMs)} · ${mistakeLabel}`;
    item.appendChild(label);

    const date = document.createElement('span');
    date.textContent = play.completedAt
      ? play.completedAt.toLocaleDateString()
      : '';
    item.appendChild(date);

    list.appendChild(item);
  }
  recentSection.appendChild(list);
  statsContent.appendChild(recentSection);
}

async function openStatsOverlay(): Promise<void> {
  const requestId = ++statsRequestId;
  statsOverlay.classList.remove('hidden');
  renderStatsMessage('Loading…', 'stats-loading');

  try {
    const plays = await fetchUserPlays();
    if (requestId !== statsRequestId) return;
    renderStatsData(plays);
  } catch (err) {
    if (requestId !== statsRequestId) return;
    renderStatsMessage('Stats unavailable right now.', 'stats-error');
    console.warn('Failed to load stats:', err);
  }
}

function closeStatsOverlay(): void {
  statsRequestId++;
  statsOverlay.classList.add('hidden');
}

// ── Calendar ──────────────────────────────────────────────────────────────────
// #41: browse past daily puzzles and see which days are already completed.
// Completion is derived client-side by recomputing each visible day's puzzle
// ids (dailyPuzzleId, memoized) and checking them against the signed-in
// user's completed plays — no new Firestore field/rules needed. Cheapest
// difficulties are checked first per day, and only difficulties the user has
// ever completed at all are checked, since generating an 'expert' puzzle
// (~130ms) for every day in a month would visibly freeze the UI otherwise.
const CALENDAR_DIFFICULTY_CHECK_ORDER: Difficulty[] = [
  'easy',
  'normal',
  'hard',
  'expert',
];
// Bumped on every open/close/navigate, mirroring statsRequestId — a stale
// in-flight month scan bails instead of overwriting a newer render.
let calendarRequestId = 0;
let calendarYear = 0;
let calendarMonth = 0;
let calendarPlays: UserPlay[] = [];

async function computeCompletedDates(
  year: number,
  month: number,
  plays: UserPlay[],
  requestId: number,
): Promise<Set<string> | null> {
  const playedIds = new Set(plays.map((p) => p.puzzleId));
  const candidateDifficulties = CALENDAR_DIFFICULTY_CHECK_ORDER.filter((d) =>
    difficultiesWithCompletions(plays).has(d),
  );
  const completed = new Set<string>();
  if (candidateDifficulties.length === 0) return completed;

  const dates = selectableDatesInMonth(
    year,
    month,
    todayUtc(),
    MIN_CALENDAR_DATE,
  );

  for (const date of dates) {
    for (const diff of candidateDifficulties) {
      if (playedIds.has(dailyPuzzleId(date, diff))) {
        completed.add(date);
        break;
      }
    }
    // Yield after every date rather than batching several — a close/nav
    // should bail within one date's worth of (possibly ~130ms 'expert')
    // generation, not up to a batch's worth of it (flagged by Copilot on
    // PR #42).
    await new Promise((r) => setTimeout(r, 0));
    if (requestId !== calendarRequestId) return null;
  }

  return completed;
}

function renderCalendarMessage(text: string): void {
  calendarContent.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'stats-loading';
  p.textContent = text;
  calendarContent.appendChild(p);
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function renderCalendarGrid(days: CalendarDay[]): void {
  calendarContent.innerHTML = '';

  const weekdayRow = document.createElement('div');
  weekdayRow.className = 'calendar-weekday-row';
  for (const label of WEEKDAY_LABELS) {
    const span = document.createElement('span');
    span.textContent = label;
    weekdayRow.appendChild(span);
  }
  calendarContent.appendChild(weekdayRow);

  const grid = document.createElement('div');
  grid.className = 'calendar-grid';
  for (const cell of days) {
    const btn = document.createElement('button');
    btn.className = 'calendar-day';
    btn.textContent = String(cell.day);
    btn.disabled = !cell.selectable;
    if (!cell.inCurrentMonth) btn.classList.add('calendar-day-padding');
    if (cell.status === 'completed')
      btn.classList.add('calendar-day-completed');
    if (cell.selectable) btn.dataset.date = cell.date;
    btn.setAttribute(
      'aria-label',
      cell.status === 'completed'
        ? `${formatCalendarDayLabel(cell.date)}, completed`
        : formatCalendarDayLabel(cell.date),
    );
    grid.appendChild(btn);
  }
  calendarContent.appendChild(grid);
}

async function loadAndRenderCalendarMonth(requestId: number): Promise<void> {
  btnCalendarPrev.disabled = !canGoToPreviousMonth(
    calendarYear,
    calendarMonth,
    MIN_CALENDAR_DATE,
  );
  btnCalendarNext.disabled = !canGoToNextMonth(
    calendarYear,
    calendarMonth,
    todayUtc(),
  );
  calendarMonthLabel.textContent = formatMonthLabel(
    calendarYear,
    calendarMonth,
  );
  renderCalendarMessage('Loading…');

  const completedDates = await computeCompletedDates(
    calendarYear,
    calendarMonth,
    calendarPlays,
    requestId,
  );
  if (completedDates === null || requestId !== calendarRequestId) return;

  const days = buildCalendarMonth(
    calendarYear,
    calendarMonth,
    todayUtc(),
    MIN_CALENDAR_DATE,
    completedDates,
  );
  renderCalendarGrid(days);
}

async function openCalendarOverlay(): Promise<void> {
  const requestId = ++calendarRequestId;
  const today = new Date();
  calendarYear = today.getUTCFullYear();
  calendarMonth = today.getUTCMonth();
  calendarOverlay.classList.remove('hidden');
  renderCalendarMessage('Loading…');

  // Browsing/playing a past date needs no completion data at all — only the
  // 'completed' markers depend on it — so a fetchUserPlays() failure (no
  // Firebase configured, offline, etc.) degrades to "no known completions"
  // rather than blocking the whole calendar, matching this repo's "never
  // let storage/backend issues block gameplay" pattern (see firebase.ts).
  try {
    calendarPlays = await fetchUserPlays();
  } catch (err) {
    if (requestId !== calendarRequestId) return;
    calendarPlays = [];
    console.warn('Failed to load play history for calendar:', err);
  }
  if (requestId !== calendarRequestId) return;
  await loadAndRenderCalendarMonth(requestId);
}

function closeCalendarOverlay(): void {
  calendarRequestId++;
  calendarOverlay.classList.add('hidden');
}

function handleCalendarNav(delta: number): void {
  const requestId = ++calendarRequestId;
  const { year, month } = shiftMonth(calendarYear, calendarMonth, delta);
  calendarYear = year;
  calendarMonth = month;
  loadAndRenderCalendarMonth(requestId);
}

function handleCalendarDayClick(e: MouseEvent): void {
  const target = (e.target as HTMLElement).closest(
    'button[data-date]',
  ) as HTMLButtonElement | null;
  if (!target || target.disabled) return;
  const date = target.dataset.date!;
  // Defense in depth — the button should already be disabled for an
  // out-of-range date, but re-check before acting on it regardless.
  if (!isDateSelectable(date, todayUtc(), MIN_CALENDAR_DATE)) return;
  closeCalendarOverlay();
  startDailyGame(difficulty, date, target);
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

  btnDaily.addEventListener('click', () => {
    closeDrawer();
    startDailyGame(difficulty, todayUtc(), btnDaily);
  });
  btnDailyRandom.addEventListener('click', () => {
    closeDrawer();
    const date = todayUtc();
    startDailyGame(dailyRandomDifficulty(date), date, btnDailyRandom);
  });

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

  btnSignIn.addEventListener('click', () => {
    closeDrawer();
    openSignInOverlay();
  });
  btnCloseSignIn.addEventListener('click', closeSignInOverlay);
  btnGoogleSignIn.addEventListener('click', () => handleGoogleSignIn());
  btnEmailLinkSignIn.addEventListener('click', () => handleEmailLinkSignIn());
  btnSignOut.addEventListener('click', () => {
    closeDrawer();
    handleSignOut();
  });

  btnStats.addEventListener('click', () => {
    closeDrawer();
    openStatsOverlay();
  });
  btnCloseStats.addEventListener('click', closeStatsOverlay);

  btnCalendar.addEventListener('click', () => {
    closeDrawer();
    openCalendarOverlay();
  });
  btnCloseCalendar.addEventListener('click', closeCalendarOverlay);
  btnCalendarPrev.addEventListener('click', () => handleCalendarNav(-1));
  btnCalendarNext.addEventListener('click', () => handleCalendarNav(1));
  calendarContent.addEventListener('click', handleCalendarDayClick);

  btnMenu.addEventListener('click', openDrawer);
  btnCloseMenu.addEventListener('click', dismissDrawer);
  drawerBackdrop.addEventListener('click', dismissDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && secondaryNav.classList.contains('open')) {
      dismissDrawer();
    }
  });
  // #drawerBackdrop's position:fixed is unconditional (not scoped to the
  // drawer media query), so resizing/rotating out of drawer mode while open
  // would otherwise leave it covering the page with no visible hamburger
  // left to dismiss it — closeDrawer() is a no-op if already closed. Not
  // dismissDrawer(): a resize shouldn't steal focus to #btnMenu.
  window.addEventListener('resize', () => closeDrawer());
  // Establishes the correct initial `inert` state for #secondaryNav (see
  // closeDrawer()) — neither open nor close has run yet at page load.
  closeDrawer();

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
