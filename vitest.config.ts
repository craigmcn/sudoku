import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    // happy-dom (not 'node') so tests can exercise browser globals — needed
    // for auth.ts's window.localStorage/location/prompt use in the
    // email-link sign-in flow, which must survive a full page reload.
    environment: 'happy-dom',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/solver.ts', 'src/game.ts'],
    },
  },
})
