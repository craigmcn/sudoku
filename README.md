# Sudoku

A browser-based Sudoku game with four difficulty levels, pencil marks, undo, hints, and a timer.

## Using the app

- Select a difficulty (Easy / Normal / Hard / Expert) to generate a new puzzle
- Click a cell, then type a digit (1–9) to enter a number
- Press **N** to toggle pencil-mark (notes) mode
- Use the toolbar buttons or keyboard shortcuts:
  - **Backspace / Delete / 0** — erase the selected cell
  - **Arrow keys** — move selection
  - **Undo** — step back one move (also restores the mistake count)
  - **Hint** — reveals the correct value for the selected cell

Conflicts (duplicate digits in the same row, column, or box) are highlighted in red. The puzzle is complete when all cells are filled correctly.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 24.x LTS (see `.nvmrc`)
- [Yarn](https://yarnpkg.com/) 4.x — run `corepack enable` to activate

### Install

```bash
yarn install
```

### Commands

```bash
yarn dev           # dev server at http://localhost:3070
yarn build         # production build → dist/
yarn preview       # preview the production build locally
yarn typecheck     # TypeScript type-check (no emit)
yarn lint          # ESLint
yarn lint:fix      # ESLint with auto-fix
yarn format        # Prettier
yarn test          # Vitest in watch mode
yarn test:run      # Vitest single pass
yarn test:coverage # Vitest with v8 coverage report
```
