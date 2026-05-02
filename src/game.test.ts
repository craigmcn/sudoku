import { describe, expect, it } from 'vitest'
import {
  applyHint,
  eraseCell,
  enterNumber,
  erasePeerNotes,
  getConflicts,
  getPeerCoords,
  selectCell,
  toggleNote,
  toggleNotesMode,
  undoMove,
} from './game'
import type { GameState } from './game'
import type { Board } from './solver'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyNotes(): number[][] {
  return Array.from({ length: 9 }, () => Array(9).fill(0))
}

const SOLUTION: Board = [
  [5, 3, 4, 6, 7, 8, 9, 1, 2],
  [6, 7, 2, 1, 9, 5, 3, 4, 8],
  [1, 9, 8, 3, 4, 2, 5, 6, 7],
  [8, 5, 9, 7, 6, 1, 4, 2, 3],
  [4, 2, 6, 8, 5, 3, 7, 9, 1],
  [7, 1, 3, 9, 2, 4, 8, 5, 6],
  [9, 6, 1, 5, 3, 7, 2, 8, 4],
  [2, 8, 7, 4, 1, 9, 6, 3, 5],
  [3, 4, 5, 2, 8, 6, 1, 7, 9],
]

// Three non-given cells: (0,2)=4, (0,3)=6, (1,1)=7
function makeState(overrides: Partial<GameState> = {}): GameState {
  const puzzle: Board = SOLUTION.map(r => [...r])
  puzzle[0][2] = null
  puzzle[0][3] = null
  puzzle[1][1] = null

  const given: boolean[][] = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => puzzle[r][c] !== null),
  )

  return {
    puzzle,
    solution: SOLUTION.map(r => [...r]),
    userBoard: puzzle.map(r => [...r]),
    given,
    selected: null,
    notes: emptyNotes(),
    notesMode: false,
    difficulty: 'easy',
    startTime: 0,
    elapsed: 0,
    solved: false,
    mistakes: 0,
    history: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// getPeerCoords
// ---------------------------------------------------------------------------

describe('getPeerCoords', () => {
  it('returns exactly 20 peers', () => {
    expect(getPeerCoords(0, 0)).toHaveLength(20)
  })

  it('does not include the cell itself', () => {
    const peers = getPeerCoords(4, 4)
    expect(peers.some(([r, c]) => r === 4 && c === 4)).toBe(false)
  })

  it('includes a row peer, a column peer, and a box peer', () => {
    const peers = getPeerCoords(0, 0)
    expect(peers.some(([r, c]) => r === 0 && c === 8)).toBe(true) // row
    expect(peers.some(([r, c]) => r === 8 && c === 0)).toBe(true) // col
    expect(peers.some(([r, c]) => r === 2 && c === 2)).toBe(true) // box
  })

  it('all coordinates are within [0..8]', () => {
    for (const [r, c] of getPeerCoords(4, 4)) {
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(8)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(8)
    }
  })
})

// ---------------------------------------------------------------------------
// toggleNote
// ---------------------------------------------------------------------------

describe('toggleNote', () => {
  it('sets the bit for the given digit', () => {
    const notes = toggleNote(emptyNotes(), 0, 0, 4)
    expect(notes[0][0] & (1 << 3)).toBeTruthy()
  })

  it('clears the bit when toggled a second time', () => {
    const once = toggleNote(emptyNotes(), 0, 0, 4)
    const twice = toggleNote(once, 0, 0, 4)
    expect(twice[0][0]).toBe(0)
  })

  it('does not affect other cells', () => {
    const notes = toggleNote(emptyNotes(), 0, 0, 4)
    expect(notes[0][1]).toBe(0)
    expect(notes[1][0]).toBe(0)
  })

  it('does not affect other digits in the same cell', () => {
    const notes = toggleNote(emptyNotes(), 0, 0, 4)
    expect(notes[0][0] & (1 << 4)).toBe(0) // digit 5 bit untouched
  })
})

// ---------------------------------------------------------------------------
// erasePeerNotes
// ---------------------------------------------------------------------------

describe('erasePeerNotes', () => {
  function notesWithBit(bit: number): number[][] {
    return Array.from({ length: 9 }, () => Array(9).fill(bit))
  }

  it('clears the bit for the digit in every cell of the same row', () => {
    const notes = erasePeerNotes(notesWithBit(1 << 3), 0, 0, 4)
    for (let c = 1; c < 9; c++) {
      expect(notes[0][c] & (1 << 3)).toBe(0)
    }
  })

  it('clears the bit for the digit in every cell of the same column', () => {
    const notes = erasePeerNotes(notesWithBit(1 << 3), 0, 0, 4)
    for (let r = 1; r < 9; r++) {
      expect(notes[r][0] & (1 << 3)).toBe(0)
    }
  })

  it('clears the bit for the digit in the same 3×3 box', () => {
    const notes = erasePeerNotes(notesWithBit(1 << 3), 0, 0, 4)
    expect(notes[1][1] & (1 << 3)).toBe(0)
    expect(notes[2][2] & (1 << 3)).toBe(0)
  })

  it('does not touch a different digit bit', () => {
    const notes = erasePeerNotes(notesWithBit(0b11000), 0, 0, 4) // bits for digits 4 & 5
    // digit 5 bit (1<<4) should be untouched in peers
    expect(notes[0][1] & (1 << 4)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// selectCell
// ---------------------------------------------------------------------------

describe('selectCell', () => {
  it('selects a cell', () => {
    expect(selectCell(makeState(), 2, 3).selected).toEqual({ row: 2, col: 3 })
  })

  it('deselects when the same cell is clicked again', () => {
    const s = makeState({ selected: { row: 2, col: 3 } })
    expect(selectCell(s, 2, 3).selected).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// enterNumber
// ---------------------------------------------------------------------------

describe('enterNumber', () => {
  it('does nothing without a selection', () => {
    const s = makeState()
    expect(enterNumber(s, 5)).toBe(s)
  })

  it('does nothing on a given cell', () => {
    const s = makeState({ selected: { row: 0, col: 0 } })
    expect(enterNumber(s, 9)).toBe(s)
  })

  it('enters a correct number without incrementing mistakes', () => {
    const s = makeState({ selected: { row: 0, col: 2 } }) // solution = 4
    const next = enterNumber(s, 4)
    expect(next.userBoard[0][2]).toBe(4)
    expect(next.mistakes).toBe(0)
  })

  it('increments mistakes on a wrong number', () => {
    const s = makeState({ selected: { row: 0, col: 2 } })
    expect(enterNumber(s, 9).mistakes).toBe(1)
  })

  it('toggles a note in notes mode', () => {
    const s = makeState({ selected: { row: 0, col: 2 }, notesMode: true })
    expect(enterNumber(s, 3).notes[0][2] & (1 << 2)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// eraseCell
// ---------------------------------------------------------------------------

describe('eraseCell', () => {
  it('does nothing on a given cell', () => {
    const s = makeState({ selected: { row: 0, col: 0 } })
    expect(eraseCell(s)).toBe(s)
  })

  it('clears an entered value', () => {
    const s = makeState({ selected: { row: 0, col: 2 } })
    const filled = enterNumber(s, 9)
    expect(eraseCell({ ...filled, selected: { row: 0, col: 2 } }).userBoard[0][2]).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// undoMove
// ---------------------------------------------------------------------------

describe('undoMove', () => {
  it('does nothing with empty history', () => {
    const s = makeState()
    expect(undoMove(s)).toBe(s)
  })

  it('restores the previous board and mistake count', () => {
    const s = makeState({ selected: { row: 0, col: 2 } })
    const after = enterNumber(s, 9)
    const undone = undoMove(after)
    expect(undone.userBoard[0][2]).toBeNull()
    expect(undone.mistakes).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// toggleNotesMode
// ---------------------------------------------------------------------------

describe('toggleNotesMode', () => {
  it('toggles the flag both ways', () => {
    const s = makeState()
    expect(toggleNotesMode(s).notesMode).toBe(true)
    expect(toggleNotesMode(toggleNotesMode(s)).notesMode).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// applyHint
// ---------------------------------------------------------------------------

describe('applyHint', () => {
  it('does nothing without a selection', () => {
    const s = makeState()
    expect(applyHint(s)).toBe(s)
  })

  it('reveals the solution value and marks the cell as given', () => {
    const s = makeState({ selected: { row: 0, col: 2 } })
    const next = applyHint(s)
    expect(next.userBoard[0][2]).toBe(4)
    expect(next.given[0][2]).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getConflicts
// ---------------------------------------------------------------------------

describe('getConflicts', () => {
  it('returns empty set with no conflicts', () => {
    expect(getConflicts(makeState()).size).toBe(0)
  })

  it('flags both cells in a row conflict', () => {
    const userBoard = SOLUTION.map(r => [...r]) as Board
    userBoard[0][2] = 5 // duplicate of (0,0) in row 0
    const conflicts = getConflicts(makeState({ userBoard }))
    expect(conflicts.has('0,0')).toBe(true)
    expect(conflicts.has('0,2')).toBe(true)
  })
})
