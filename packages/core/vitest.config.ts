import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// `"type": "module"`, so `__dirname` is not defined here.
const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	resolve: {
		// Resolve db to its TS source: its `dist/` is gitignored and not built in CI. The `/src`
		// rule must precede the bare one, or imports become a doubled `src/src`.
		alias: [
			{
				find: /^@budget-planner\/db\/src/,
				replacement: resolve(__dirname, '../db/src'),
			},
			{
				find: /^@budget-planner\/db/,
				replacement: resolve(__dirname, '../db/src'),
			},
		],
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.test.ts'],
		setupFiles: ['./vitest.setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
		},
	},
})
