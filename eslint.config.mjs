import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import vitest from '@vitest/eslint-plugin'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

export default [
  {
    files: ['**/*.ts'],
    plugins: { '@typescript-eslint': tsPlugin },
    languageOptions: {
      parser: tsParser,
      globals: globals.browser,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-console': 'warn',
    },
  },
  prettierConfig,
  {
    files: ['src/**/*.test.ts'],
    plugins: { vitest },
    languageOptions: {
      globals: vitest.environments.env.globals,
    },
  },
]
