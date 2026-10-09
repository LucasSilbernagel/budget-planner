import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
		setupFiles: ['./vitest.setup.ts'],
		// PGlite takes its session TimeZone from the host.
		env: { TZ: 'UTC' },
	},
})
