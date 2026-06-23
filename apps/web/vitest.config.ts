import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // 'node' for server-function / utility tests. Switch to 'jsdom' once it's
    // installed (devDependency) for React component tests.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'],
    },
  },
})
