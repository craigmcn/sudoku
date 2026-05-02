import { describe, expect, it } from 'vitest'
import { isValid } from './solver'
import type { Board } from './solver'

function emptyBoard(): Board {
  return Array.from({ length: 9 }, () => Array(9).fill(null))
}

describe('isValid', () => {
  it('allows a number with no conflicts', () => {
    expect(isValid(emptyBoard(), 0, 0, 5)).toBe(true)
  })

  it('rejects a row conflict', () => {
    const board = emptyBoard()
    board[0][3] = 5
    expect(isValid(board, 0, 0, 5)).toBe(false)
  })

  it('rejects a column conflict', () => {
    const board = emptyBoard()
    board[3][0] = 5
    expect(isValid(board, 0, 0, 5)).toBe(false)
  })

  it('rejects a box conflict', () => {
    const board = emptyBoard()
    board[1][1] = 5
    expect(isValid(board, 0, 0, 5)).toBe(false)
  })

  it('ignores the cell itself when checking', () => {
    const board = emptyBoard()
    board[0][0] = 5
    expect(isValid(board, 0, 0, 5)).toBe(true)
  })
})
