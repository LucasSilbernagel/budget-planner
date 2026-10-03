import { defineConfig } from 'vitest/config'

// Story 92.1: PGlite takes its session TimeZone from the host (`Etc/GMT+5` on an
// EDT box), and a `timestamp without time zone` default then stores that zone's
// wall time (ops-2). Pin the run to UTC, as CI's runners and production's pinned
// connections are. ⚠️ Set HERE, in the main process before the worker threads
// start, not in `test.env`: this package's Vitest 1.6 runs threads, and MEASURED
// `test.env: { TZ: 'UTC' }` reached `process.env` but NOT the zone (PGlite still
// `Etc/GMT+5`, `getTimezoneOffset()` 240). `e2e-pglite-timezone.test.ts` forces
// `TZ=America/New_York` on its CHILD process explicitly, so it is unaffected.
process.env.TZ = 'UTC'

export default defineConfig({
  test: {
    // Use node environment for non-DOM tests (schema validation)
    environment: 'node',
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
