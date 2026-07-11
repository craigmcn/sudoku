import { test, expect } from '@playwright/test'

test('loads a puzzle with 81 cells and some given clues', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.cell')).toHaveCount(81)
  const easyGivens = await page.locator('.cell.given').count()
  expect(easyGivens).toBeGreaterThan(0)
  expect(easyGivens).toBeLessThan(81)
  await expect(page.locator('#timer')).toHaveText('00:00')
  await expect(page.locator('#btnPause')).toBeDisabled()
})

test('switching difficulty starts a new puzzle with fewer clues than easy', async ({ page }) => {
  await page.goto('/')

  const easyGivens = await page.locator('.cell.given').count()

  await page.getByRole('button', { name: 'Expert' }).click()

  const expertGivens = await page.locator('.cell.given').count()
  expect(expertGivens).toBeLessThan(easyGivens)
  await expect(page.getByRole('button', { name: 'Expert' })).toHaveClass(/active/)
})

test('hint reveals a cell, starts the timer, and enables pause', async ({ page }) => {
  await page.goto('/')

  const emptyCell = page.locator('.cell:not(.given)').first()
  const { row, col } = await emptyCell.evaluate(el => (el as HTMLElement).dataset) as {
    row: string
    col: string
  }
  await emptyCell.click()
  await page.locator('#btnHint').click()

  const targetCell = page.locator(`.cell[data-row="${row}"][data-col="${col}"]`)
  await expect(targetCell).toHaveClass(/has-value/)
  await expect(targetCell).toHaveClass(/given/)
  await expect(page.locator('#btnPause')).toBeEnabled()
})

test('pausing hides the board interaction behind the pause overlay', async ({ page }) => {
  await page.goto('/')

  await page.locator('.cell:not(.given)').first().click()
  await page.locator('#btnHint').click()
  await page.locator('#btnPause').click()

  await expect(page.locator('#pauseOverlay')).not.toHaveClass(/hidden/)

  await page.locator('#btnResume').click()
  await expect(page.locator('#pauseOverlay')).toHaveClass(/hidden/)
})

test('notes mode pencils in a digit without filling the cell', async ({ page }) => {
  await page.goto('/')

  const emptyCell = page.locator('.cell:not(.given)').first()
  await emptyCell.click()
  await page.locator('#btnNotes').click()
  await expect(page.locator('#btnNotes')).toHaveClass(/active/)

  await page.locator('.num-btn[data-num="5"]').click()

  await expect(emptyCell).toHaveClass(/has-notes/)
  await expect(emptyCell.locator('.cell-value')).toHaveText('')
  await expect(emptyCell.locator('.note[data-num="5"]')).toHaveText('5')
})

test('undo restores the previous cell state', async ({ page }) => {
  await page.goto('/')

  const emptyCell = page.locator('.cell:not(.given)').first()
  await emptyCell.click()
  await page.locator('#btnNotes').click()
  await page.locator('.num-btn[data-num="3"]').click()
  await expect(emptyCell).toHaveClass(/has-notes/)

  await page.locator('#btnUndo').click()

  await expect(emptyCell).not.toHaveClass(/has-notes/)
})

test('new game reshuffles the board and resets the timer', async ({ page }) => {
  await page.goto('/')

  await page.locator('.cell:not(.given)').first().click()
  await page.locator('#btnHint').click()
  await expect(page.locator('#btnPause')).toBeEnabled()

  await page.locator('#btnNewGame').click()

  await expect(page.locator('#timer')).toHaveText('00:00')
  await expect(page.locator('#btnPause')).toBeDisabled()
  await expect(page.locator('.cell')).toHaveCount(81)
})
