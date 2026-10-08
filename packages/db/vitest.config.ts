import { defineConfig } from 'vitest/config'

// Set here, before worker threads start: Vitest 1.6 threads ignore `test.env.TZ` for the zone,
// and PGlite takes its session TimeZone from the host.
process.env.TZ = 'UTC'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
