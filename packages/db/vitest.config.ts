import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Use jsdom or happy-dom for DOM testing if needed
    // environment: 'node', // Default for non-DOM tests
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    },
  },
})
