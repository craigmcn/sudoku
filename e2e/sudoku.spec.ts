import { test, expect } from '@playwright/test'

test('loads a puzzle with 81 cells and some given clues', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#loading')).toHaveClass(/hidden/)

  await expect(page.locator('.cell')).toHaveCount(81)
  const easyGivens = await page.locator('.cell.given').count()
  expect(easyGivens).toBeGreaterThan(0)
  expect(easyGivens).toBeLessThan(81)
  await expect(page.locator('#timer')).toHaveText('00:00')
  await expect(page.locator('#btnPause')).toBeDisabled()
})

test('switching difficulty starts a new puzzle with fewer clues than easy', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#loading')).toHaveClass(/hidden/)

  const easyGivens = await page.locator('.cell.given').count()

  await page.getByRole('button', { name: 'Expert' }).click()
  await expect(page.locator('#loading')).toHaveClass(/hidden/)

  const expertGivens = await page.locator('.cell.given').count()
  expect(expertGivens).toBeLessThan(easyGivens)
  await expect(page.getByRole('button', { name: 'Expert' })).toHaveClass(/active/)
})

test('hint reveals a cell, starts the timer, and enables pause', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#loading')).toHaveClass(/hidden/)

  const emptyCell = page.locator('.cell:not(.given)').first()
  const { row, col } = (await emptyCell.evaluate(el => (el as HTMLElement).dataset)) as {
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

test('pausing blocks board input and hides it behind the pause overlay', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#loading')).toHaveClass(/hidden/)

  const cells = page.locator('.cell:not(.given)')
  const [hintPos, otherPos] = await Promise.all([
    cells.nth(0).evaluate(el => (el as HTMLElement).dataset) as Promise<{
      row: string
      col: string
    }>,
    cells.nth(1).evaluate(el => (el as HTMLElement).dataset) as Promise<{
      row: string
      col: string
    }>,
  ])
  const otherCell = page.locator(`.cell[data-row="${otherPos.row}"][data-col="${otherPos.col}"]`)

  await page
    .locator(`.cell[data-row="${hintPos.row}"][data-col="${hintPos.col}"]`)
    .click()
  await page.locator('#btnHint').click()

  await otherCell.click()
  await page.locator('#btnPause').click()
  await expect(page.locator('#pauseOverlay')).not.toHaveClass(/hidden/)

  // The pause overlay physically covers the numpad, so a normal click can't
  // reach it — force the click to also confirm the `paused` state guard
  // in game.ts makes the input a no-op even if the overlay were bypassed.
  await page.locator('.num-btn[data-num="4"]').click({ force: true })
  await expect(otherCell).not.toHaveClass(/has-value/)

  await page.locator('#btnResume').click()
  await expect(page.locator('#pauseOverlay')).toHaveClass(/hidden/)
})

test('notes mode pencils in a digit without filling the cell', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#loading')).toHaveClass(/hidden/)

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
  await expect(page.locator('#loading')).toHaveClass(/hidden/)

  const emptyCell = page.locator('.cell:not(.given)').first()
  await emptyCell.click()
  await page.locator('#btnNotes').click()
  await page.locator('.num-btn[data-num="3"]').click()
  await expect(emptyCell).toHaveClass(/has-notes/)

  await page.locator('#btnUndo').click()

  await expect(emptyCell).not.toHaveClass(/has-notes/)
})

test('new game clears progress and resets the timer and pause state', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#loading')).toHaveClass(/hidden/)

  await page.locator('.cell:not(.given)').first().click()
  await page.locator('#btnHint').click()
  await expect(page.locator('#btnPause')).toBeEnabled()

  await page.locator('#btnNewGame').click()
  await expect(page.locator('#loading')).toHaveClass(/hidden/)

  await expect(page.locator('#timer')).toHaveText('00:00')
  await expect(page.locator('#btnPause')).toBeDisabled()
  await expect(page.locator('.cell')).toHaveCount(81)
})
