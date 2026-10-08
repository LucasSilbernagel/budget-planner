import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import {
	DB_SERVER_PORT,
	E2E_DATABASE_URL,
	E2E_DB_PORT,
	FAKE_PADDLE,
	MAIL_OUTBOX,
	NO_OUTBOUND_PROXY,
	SEEDED_USER,
} from './e2e/helpers/db-harness'
import { PROD_E2E_SESSION_SECRET } from './e2e/helpers/prod-session'

// Tier is a server-side fact (E2E_SESSION_SEED at boot), so each tier and build gets its
// own server, and projects select specs by filename: .paid, .prod, .db, .screenshot.

// Screenshot baselines are CI-rendered (DejaVu Sans), so `pnpm gates` never runs them.
const SCREENSHOT_SPEC = /\.screenshot(\.paid)?\.spec\.ts$/
const DB_SPEC = /\.db\.spec\.ts$/

const externalBaseURL = process.env['PLAYWRIGHT_BASE_URL']
const baseURL = externalBaseURL || 'http://localhost:5173'

const PAID_SESSION_SEED = JSON.stringify({
	isAuthenticated: true,
	userId: 'e2e-paid-user',
	email: 'e2e-paid@example.test',
	subscriptionStatus: 'active',
})

const PAID_PORT = 5174
const paidBaseURL = `http://localhost:${PAID_PORT}`

/**
 * `env` must be passed for every server, the free one too: Playwright merges the ambient
 * environment in, and an exported E2E_SESSION_SEED would make the free server paid.
 */
const devServer = (port: number, env: DevServerEnv) => ({
	// `--strictPort` (inside the guard) so a busy port fails instead of sliding to the next
	// one. The guard also records mid-run dependency re-optimizations.
	command: `node e2e/helpers/dev-server-dep-guard.mjs ${port}`,
	url: `http://localhost:${port}`,
	// The DB server is never reused: a stray :5176 carries whatever DATABASE_URL and
	// outbox it was started with.
	reuseExistingServer: env.databaseUrl ? false : !process.env['CI'],
	timeout: 120_000,
	// Everything passed explicitly, for the merge reason above: an ambient DATABASE_URL or
	// EMAIL_API_KEY must not reach these servers.
	env: {
		E2E_SESSION_SEED: env.sessionSeed,
		DATABASE_URL: env.databaseUrl ?? '',
		E2E_MAIL_OUTBOX: env.mailOutbox ?? '',
		EMAIL_API_KEY: '',
		...(env.siteUrl ? { SITE_URL: env.siteUrl } : {}),
		...env.extra,
	},
})

interface DevServerEnv {
	sessionSeed: string
	databaseUrl?: string
	mailOutbox?: string
	siteUrl?: string
	extra?: Record<string, string>
}

const PROD_PORT = 5175
const prodBaseURL = `http://127.0.0.1:${PROD_PORT}`

/**
 * `DATABASE_URL: ''` is a safety requirement, since the ambient env merges in. Never
 * reused: a server from an earlier build would serve an old bundle.
 */
const prodServer = {
	command: 'pnpm build && node server-entry.mjs',
	url: `${prodBaseURL}/api/health`,
	reuseExistingServer: false,
	timeout: 180_000,
	env: {
		NODE_ENV: 'production',
		PORT: String(PROD_PORT),
		HOST: '127.0.0.1',
		SITE_URL: prodBaseURL,
		SESSION_SECRET: PROD_E2E_SESSION_SECRET,
		DATABASE_URL: '',
		E2E_SESSION_SEED: '',
		EMAIL_API_KEY: '',
		E2E_MAIL_OUTBOX: '',
	},
}

// Resolved against the shell's cwd: Playwright resolves a relative template against
// this file's directory. A first run into an empty directory fails by design.
const screenshotDir = process.env['SCREENSHOT_DIR']
	? resolve(process.cwd(), process.env['SCREENSHOT_DIR'])
	: undefined

// The teardown ignores dep-reload logs older than this. Always this load's own time:
// an inherited stale value would count old logs.
process.env['E2E_RUN_STARTED_AT'] = String(Date.now())

const dbBaseURL = `http://localhost:${DB_SERVER_PORT}`

// The teardown checks exactly these ports (via the env), so it can't drift.
const DEV_SERVERS: ReadonlyArray<readonly [number, DevServerEnv]> = [
	[5173, { sessionSeed: '' }],
	[PAID_PORT, { sessionSeed: PAID_SESSION_SEED }],
	[
		DB_SERVER_PORT,
		{
			sessionSeed: '',
			databaseUrl: E2E_DATABASE_URL,
			mailOutbox: MAIL_OUTBOX,
			siteUrl: dbBaseURL,
			// Every Paddle variable explicitly (all fakes), so no ambient Paddle value reaches it.
			extra: {
				PADDLE_ENVIRONMENT: FAKE_PADDLE.environment,
				PADDLE_API_KEY: FAKE_PADDLE.apiKey,
				PADDLE_CLIENT_TOKEN: FAKE_PADDLE.clientToken,
				PADDLE_WEBHOOK_SECRET: FAKE_PADDLE.webhookSecret,
				PADDLE_WEBHOOK_MAX_AGE_SECONDS: '300',
				PADDLE_MONTHLY_PRICE_ID: FAKE_PADDLE.monthlyPriceId,
				PADDLE_ANNUAL_PRICE_ID: FAKE_PADDLE.annualPriceId,
				PADDLE_LIFETIME_PRICE_ID: FAKE_PADDLE.lifetimePriceId,
				// No request leaves for the internet: Node sends fetch/http through a refusing proxy.
				// Set the lowercase names too: Node prefers them, and the shell's env merges in.
				NODE_USE_ENV_PROXY: '1',
				HTTP_PROXY: NO_OUTBOUND_PROXY,
				HTTPS_PROXY: NO_OUTBOUND_PROXY,
				NO_PROXY: 'localhost,127.0.0.1,::1',
				http_proxy: NO_OUTBOUND_PROXY,
				https_proxy: NO_OUTBOUND_PROXY,
				no_proxy: 'localhost,127.0.0.1,::1',
			},
		},
	],
]

/** Listed first so it is up before :5176 starts; never reused, so every run is fresh. */
const dbServer = {
	command: 'node e2e/helpers/pglite-server.mjs',
	port: E2E_DB_PORT,
	reuseExistingServer: false,
	timeout: 60_000,
	env: {
		E2E_DB_PORT: String(E2E_DB_PORT),
		E2E_DB_SEED_EMAIL: SEEDED_USER.email,
		E2E_DB_SEED_PADDLE_ID: SEEDED_USER.paddleId,
		E2E_MAIL_OUTBOX: MAIL_OUTBOX,
		// It reads neither; blanked so no ambient value is even present.
		DATABASE_URL: '',
		EMAIL_API_KEY: '',
		// The PGlite process clock is UTC too, so a dev box matches CI's UTC runners.
		TZ: 'UTC',
	},
}
process.env['E2E_DEV_SERVER_PORTS'] = externalBaseURL
	? ''
	: DEV_SERVERS.map(([port]) => port).join(',')

export default defineConfig({
	testDir: './e2e',
	globalTeardown: './e2e/global-teardown.ts',
	// One render environment (CI), so no {platform} or {projectName} in the path.
	snapshotPathTemplate: screenshotDir
		? `${screenshotDir}/{testFilePath}/{arg}{ext}`
		: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
	fullyParallel: true,
	forbidOnly: !!process.env['CI'],
	// One retry: a genuinely broken test otherwise runs three times before CI reports it.
	retries: process.env['CI'] ? 1 : 0,
	workers: process.env['CI'] ? 4 : undefined,
	reporter: 'html',
	use: {
		baseURL,
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			// Excluded, not merely unlisted: the paid specs would otherwise also run here,
			// against the free server.
			testIgnore: [/\.paid\.spec\.ts$/, /\.prod\.spec\.ts$/, DB_SPEC, SCREENSHOT_SPEC],
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'screenshots',
			testMatch: /\.screenshot\.spec\.ts$/,
			// No retry: a shot that passes only on retry is a real flake and must fail the run.
			retries: 0,
			use: { ...devices['Desktop Chrome'] },
		},
		// Dropped with PLAYWRIGHT_BASE_URL: the session seam is compiled out of a production
		// build, so the paid nav isn't measurable there.
		...(externalBaseURL
			? []
			: [
					{
						name: 'chromium-paid',
						testMatch: /\.paid\.spec\.ts$/,
						testIgnore: SCREENSHOT_SPEC,
						use: { ...devices['Desktop Chrome'], baseURL: paidBaseURL },
					},
					{
						name: 'screenshots-paid',
						testMatch: /\.screenshot\.paid\.spec\.ts$/,
						retries: 0,
						use: { ...devices['Desktop Chrome'], baseURL: paidBaseURL },
					},
					// Dropped with PLAYWRIGHT_BASE_URL too: it needs its own server and session secret.
					{
						name: 'chromium-prod',
						testMatch: /\.prod\.spec\.ts$/,
						use: { ...devices['Desktop Chrome'], baseURL: prodBaseURL },
					},
					// Dropped with PLAYWRIGHT_BASE_URL too: an external server has no database or outbox.
					{
						name: 'chromium-db',
						testMatch: DB_SPEC,
						use: { ...devices['Desktop Chrome'], baseURL: dbBaseURL },
					},
				]),
	],
	webServer: externalBaseURL
		? undefined
		: [dbServer, ...DEV_SERVERS.map(([port, env]) => devServer(port, env)), prodServer],
})
