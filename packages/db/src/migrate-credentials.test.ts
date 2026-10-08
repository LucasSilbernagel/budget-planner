import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMigrationCredentials } from './migrate-credentials'

const CA = 'CA-PEM'
const PROD = 'postgresql://bp_migrator:s3cret@budget-planner-prod-rw:5432/pgdb'

describe('buildMigrationCredentials', () => {
	it('decomposes the URL so an ssl option can be carried at all', () => {
		// drizzle-kit accepts `{ url }` OR the decomposed form with `ssl`, never both; a bare url
		// drops TLS verification.
		expect(buildMigrationCredentials('production', PROD, CA)).toEqual({
			host: 'budget-planner-prod-rw',
			port: 5432,
			user: 'bp_migrator',
			password: 's3cret',
			database: 'pgdb',
			ssl: { rejectUnauthorized: true, ca: CA },
		})
	})

	it('refuses a host the application pool would refuse', () => {
		const us = 'postgresql://u:p@abc.supabase.co:5432/db'
		expect(() => buildMigrationCredentials('production', us, CA)).toThrow(
			/danubedata|sovereign|EU/i
		)
		expect(() => buildMigrationCredentials(undefined, us, CA)).toThrow()
		expect(() => buildMigrationCredentials('staging', us, CA)).toThrow()
	})

	it('rejects a lookalike of the internal host', () => {
		const spoof = 'postgresql://u:p@budget-planner-prod-rw.attacker.com:5432/pgdb'
		expect(() => buildMigrationCredentials('production', spoof, CA)).toThrow()
	})

	it('still enforces TLS when no CA is configured', () => {
		const result = buildMigrationCredentials('production', PROD, undefined)
		expect(result.ssl).toEqual({ rejectUnauthorized: true })
	})

	it('disables TLS only for an explicitly relaxed environment', () => {
		const local = 'postgresql://u:p@localhost:5432/budget-planner-dev'
		expect(buildMigrationCredentials('development', local, undefined).ssl).toBe(false)
		expect(() => buildMigrationCredentials('production', local, undefined)).toThrow()
	})

	it('refuses a missing or unparseable URL rather than connecting to nothing', () => {
		expect(() => buildMigrationCredentials('production', undefined, CA)).toThrow(/DATABASE_URL/)
		expect(() => buildMigrationCredentials('production', '', CA)).toThrow(/DATABASE_URL/)
		expect(() => buildMigrationCredentials('production', 'not-a-url', CA)).toThrow(/DATABASE_URL/)
	})

	it('percent-decodes credentials and defaults the port', () => {
		const encoded = 'postgresql://bp%40user:p%40ss%2Fword@budget-planner-prod-rw/pgdb'
		const result = buildMigrationCredentials('production', encoded, CA)
		expect(result.user).toBe('bp@user')
		expect(result.password).toBe('p@ss/word')
		expect(result.port).toBe(5432)
	})
})

describe('sslmode in the URL cannot reach the driver (2026-09-08 production failure)', () => {
	// pg-connection-string maps `sslmode=require` to verify-full, overriding the explicit ssl and
	// dropping the CA, so the query parameter must be discarded.
	const CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'

	it.each(['require', 'verify-full', 'disable', 'no-verify'])(
		'drops ?sslmode=%s and keeps the CA-bearing ssl option',
		(mode) => {
			const creds = buildMigrationCredentials(
				'production',
				`postgresql://u:p@budget-planner-prod-rw.budgetplanner795.svc.cluster.local:5432/pgdb?sslmode=${mode}`,
				CA
			)
			expect(creds.ssl).toMatchObject({ rejectUnauthorized: true, ca: CA })
			expect(JSON.stringify(creds)).not.toContain('sslmode')
			expect(creds.database).toBe('pgdb')
			expect(creds.port).toBe(5432)
		}
	)
})

// The public endpoint is EU DanubeData, so the sovereignty rule alone does not catch it.
describe('the public endpoint is refused for migrations', () => {
	const CA = 'CA-PEM'

	it.each([
		'postgresql://bp_migrator:s@postgresql-budget-planner-prod.budgetplanner795.danubedata.ro:5445/pgdb',
		'postgresql://bp_migrator:s@postgresql-budget-planner-prod.budgetplanner795.danubedata.ro:5446/pgdb',
		'postgresql://bp_migrator:s@anything.danubedata.ro:5432/pgdb',
	])('refuses %s', (url) => {
		expect(() => buildMigrationCredentials('production', url, CA)).toThrow(
			/in-cluster|public endpoint/i
		)
	})

	it('still accepts both in-cluster writer forms', () => {
		const short = 'postgresql://bp_migrator:s@budget-planner-prod-rw:5432/pgdb'
		const fqdn =
			'postgresql://bp_migrator:s@budget-planner-prod-rw.budgetplanner795.svc.cluster.local:5432/pgdb'

		expect(buildMigrationCredentials('production', short, CA).host).toBe('budget-planner-prod-rw')
		expect(buildMigrationCredentials('production', fqdn, CA).host).toBe(
			'budget-planner-prod-rw.budgetplanner795.svc.cluster.local'
		)
	})

	it('does not constrain an explicitly relaxed local environment', () => {
		const local = 'postgresql://u:p@localhost:5432/budget-planner-dev'
		expect(() => buildMigrationCredentials('development', local, undefined)).not.toThrow()
	})
})

describe('no TLS downgrade is reachable (Story 5.18, AC-4)', () => {
	const CA = 'CA-PEM'
	const IN_CLUSTER = 'postgresql://bp_migrator:s@budget-planner-prod-rw:5432/pgdb'

	it('produces exactly the application pool ssl option, with no identity override', () => {
		const { ssl } = buildMigrationCredentials('production', IN_CLUSTER, CA)

		expect(ssl).toEqual({ rejectUnauthorized: true, ca: CA })
		expect(ssl).not.toHaveProperty('checkServerIdentity')
	})

	// `process.env[k] = undefined` stores the string "undefined"; stubEnv removes it properly.
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('takes its TLS posture only from its arguments, consulting no environment', () => {
		vi.stubEnv('DATABASE_TLS_ALLOW_HOSTNAME_MISMATCH', 'true')

		const { ssl } = buildMigrationCredentials('production', IN_CLUSTER, CA)

		expect(ssl).toEqual({ rejectUnauthorized: true, ca: CA })
		expect(ssl).not.toHaveProperty('checkServerIdentity')
	})
})

// Those call sites aren't reachable from a unit test, so assert at the source level.
describe('the retired waiver has no surviving call site (Story 5.18, AC-4)', () => {
	const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

	it.each([
		['drizzle.config.ts', '../drizzle.config.ts'],
		['migrate-preflight-cli.ts', './migrate-preflight-cli.ts'],
	])('%s neither reads the flag nor imports the deleted module', (_label, path) => {
		const source = read(path)

		expect(source).not.toMatch(/DATABASE_TLS_ALLOW_HOSTNAME_MISMATCH/)
		expect(source).not.toMatch(/hostnameMismatchAllowedFromEnv/)
		expect(source).not.toMatch(/migrate-tls/)
	})

	it('the waiver module itself is gone', () => {
		expect(existsSync(new URL('./migrate-tls.ts', import.meta.url))).toBe(false)
	})
})
