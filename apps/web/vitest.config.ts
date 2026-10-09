import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

const { version: appVersion } = JSON.parse(
	readFileSync(resolve(__dirname, './package.json'), 'utf-8')
) as { version: string }

const domTests = [
	'src/**/*.{test,spec}.tsx',
	'src/**/components/**/*.{test,spec}.ts',
	'src/**/*.dom.test.ts',
]

// Default `node` so server-only modules (the db package throws when `window` exists) import.
export default defineConfig({
	plugins: [react()],
	define: {
		__APP_VERSION__: JSON.stringify(appVersion),
	},
	resolve: {
		alias: [
			{
				find: /^@budget-planner\/core/,
				replacement: resolve(__dirname, '../../packages/core/src'),
			},
			{
				find: /^@budget-planner\/config/,
				replacement: resolve(__dirname, '../../packages/config/src'),
			},
			{
				find: /^@budget-planner\/db/,
				replacement: resolve(__dirname, '../../packages/db/src'),
			},
			{
				find: 'virtual:pwa-register',
				replacement: resolve(__dirname, './src/test/pwa-register-mock.ts'),
			},
			{ find: '@', replacement: resolve(__dirname, './src') },
		],
	},
	test: {
		globals: true,
		environment: 'node',
		setupFiles: ['./vitest.setup.ts'],
		exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
		projects: [
			{
				test: {
					name: 'node',
					include: ['src/**/*.{test,spec}.{ts,tsx}'],
					exclude: domTests,
				},
			},
			{
				test: {
					name: 'jsdom',
					environment: 'jsdom',
					include: domTests,
				},
			},
		],
		// pg.Pool connects lazily, so this dummy URL opens no connection.
		env: {
			DATABASE_URL: 'postgres://test:test@localhost:5432/budget_planner_test',
			NODE_ENV: 'test',
			SESSION_SECRET: 'test-session-secret-0123456789abcdef-fixed',
			EMAIL_API_KEY: 'test-email-api-key',
			EMAIL_FROM: 'no-reply@budgetplanner.test',
			SITE_URL: 'https://app.test',
			// PGlite's session TimeZone follows the host; UTC matches CI and production, else
			// `timestamp without time zone` defaults store local wall time.
			TZ: 'UTC',
		},
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.{ts,tsx}'],
			exclude: [
				'src/**/*.{test,spec}.{ts,tsx}',
				'src/**/__tests__/**',
				'src/mocks/**',
				'src/test/**',
			],
		},
	},
})
