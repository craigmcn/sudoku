import { describe, expect, it } from 'vitest'
import {
  applyHint,
  eraseCell,
  enterNumber,
  getConflicts,
  selectCell,
  toggleNotesMode,
  undoMove,
} from './game'
import type { GameState } from './game'
import type { Board } from './solver'

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

// Puzzle with three non-given cells: (0,2)=4, (0,3)=6, (1,1)=7
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
    notes: Array.from({ length: 9 }, () => Array(9).fill(0)),
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

describe('selectCell', () => {
  it('selects a cell', () => {
    expect(selectCell(makeState(), 2, 3).selected).toEqual({ row: 2, col: 3 })
  })

  it('deselects when the same cell is clicked again', () => {
    const s = makeState({ selected: { row: 2, col: 3 } })
    expect(selectCell(s, 2, 3).selected).toBeNull()
  })
})

describe('enterNumber', () => {
  it('does nothing without a selection', () => {
    const s = makeState()
    expect(enterNumber(s, 5)).toBe(s)
  })

  it('does nothing on a given cell', () => {
    const s = makeState({ selected: { row: 0, col: 0 } }) // (0,0) is given
    expect(enterNumber(s, 9)).toBe(s)
  })

  it('enters a correct number and does not increment mistakes', () => {
    const s = makeState({ selected: { row: 0, col: 2 } }) // solution = 4
    const next = enterNumber(s, 4)
    expect(next.userBoard[0][2]).toBe(4)
    expect(next.mistakes).toBe(0)
  })

  it('enters a wrong number and increments mistakes', () => {
    const s = makeState({ selected: { row: 0, col: 2 } }) // solution = 4
    const next = enterNumber(s, 9)
    expect(next.mistakes).toBe(1)
  })

  it('toggles a note bit in notes mode', () => {
    const s = makeState({ selected: { row: 0, col: 2 }, notesMode: true })
    const next = enterNumber(s, 3)
    expect(next.notes[0][2] & (1 << 2)).toBeTruthy()
  })

  it('clears the digit from peers notes when correct number is entered', () => {
    const notes = Array.from({ length: 9 }, () => Array(9).fill(0))
    notes[0][5] = 1 << 3 // digit 4 noted at a row peer of (0,2)
    const s = makeState({ selected: { row: 0, col: 2 }, notes })
    expect(enterNumber(s, 4).notes[0][5] & (1 << 3)).toBe(0)
  })
})

describe('eraseCell', () => {
  it('clears an entered value', () => {
    const s = makeState({ selected: { row: 0, col: 2 } })
    const filled = enterNumber(s, 9)
    const erased = eraseCell({ ...filled, selected: { row: 0, col: 2 } })
    expect(erased.userBoard[0][2]).toBeNull()
  })

  it('does nothing on a given cell', () => {
    const s = makeState({ selected: { row: 0, col: 0 } }) // given
    expect(eraseCell(s)).toBe(s)
  })
})

describe('undoMove', () => {
  it('does nothing with empty history', () => {
    const s = makeState()
    expect(undoMove(s)).toBe(s)
  })

  it('restores the previous board and mistake count', () => {
    const s = makeState({ selected: { row: 0, col: 2 } })
    const after = enterNumber(s, 9) // wrong — mistakes = 1
    const undone = undoMove(after)
    expect(undone.userBoard[0][2]).toBeNull()
    expect(undone.mistakes).toBe(0)
  })
})

describe('toggleNotesMode', () => {
  it('toggles the notes mode flag', () => {
    const s = makeState()
    expect(toggleNotesMode(s).notesMode).toBe(true)
    expect(toggleNotesMode(toggleNotesMode(s)).notesMode).toBe(false)
  })
})

describe('applyHint', () => {
  it('reveals the solution value and marks the cell as given', () => {
    const s = makeState({ selected: { row: 0, col: 2 } }) // solution = 4
    const next = applyHint(s)
    expect(next.userBoard[0][2]).toBe(4)
    expect(next.given[0][2]).toBe(true)
  })

  it('does nothing without a selection', () => {
    const s = makeState()
    expect(applyHint(s)).toBe(s)
  })
})

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
