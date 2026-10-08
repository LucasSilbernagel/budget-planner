// drizzle-kit migrate builds its own connection, so hand it the app's TLS posture and host policy
// as decomposed fields. Throws at startup so a refusal stops the migration.

import {
	buildDbSsl,
	decodeUrlField,
	isEuSovereignDbHost,
	isInClusterDbHost,
	isRelaxedDbEnv,
} from './client'

type MigrationDbSsl = ReturnType<typeof buildDbSsl>

export interface MigrationCredentials {
	host: string
	port: number
	user: string
	password: string
	database: string
	ssl: MigrationDbSsl
}

export function buildMigrationCredentials(
	nodeEnv: string | undefined,
	databaseUrl: string | undefined,
	caCert: string | undefined
): MigrationCredentials {
	if (!databaseUrl) {
		throw new Error(
			'DATABASE_URL is not configured. Migrations require DanubeData PostgreSQL in Germany (EU) for CLOUD Act immunity (NFR1, NFR2).'
		)
	}

	let url: URL
	try {
		url = new URL(databaseUrl)
	} catch {
		throw new Error('DATABASE_URL is not a parseable URL. Refusing to migrate.')
	}

	const host = url.hostname.toLowerCase()

	if (!isRelaxedDbEnv(nodeEnv)) {
		if (!isEuSovereignDbHost(host)) {
			throw new Error(
				`Refusing to migrate: "${host}" is not a DanubeData (Germany - EU) host, required for CLOUD Act immunity (NFR1, NFR2). Expected the internal writer name or a *.danubedata.ro host.`
			)
		}

		// Stricter than the pool: migrations run in-cluster only, so a public `.danubedata.ro` URL means
		// the retired DNS window was reopened.
		if (!isInClusterDbHost(host)) {
			throw new Error(
				`Refusing to migrate over the public endpoint "${host}". Migrations run in-cluster only, over internal DNS (ADR-001; the time-boxed public-DNS exception was retired by Story 5.18). Expected budget-planner-prod-rw[.budgetplanner795.svc.cluster.local].`
			)
		}
	}

	return {
		host,
		port: url.port === '' ? 5432 : Number(url.port),
		user: decodeUrlField(url.username, 'username'),
		password: decodeUrlField(url.password, 'password'),
		database: decodeUrlField(url.pathname.replace(/^\//, ''), 'database'),
		// verify-full via the app pool's own `buildDbSsl`; nothing here may weaken it.
		ssl: buildDbSsl(nodeEnv, caCert),
	}
}
