import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: [
        { dir: 'netlify' },
        { dir: 'netlify/sudoku' }, // For Netlify subdirectory
      ],
    },
  },
})
