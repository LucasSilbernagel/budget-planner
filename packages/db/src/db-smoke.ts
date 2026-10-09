// Reuses the app pool's own policy, so the smoke can never pass over a host or TLS posture
// `getPool()` would refuse.

import { buildDbSsl, isEuSovereignDbHost, isRelaxedDbEnv } from './client'

export type SmokePreconditions =
	| { ok: true; host: string; ssl: ReturnType<typeof buildDbSsl> }
	| { ok: false; reason: string }

export function assessSmokePreconditions(
	nodeEnv: string | undefined,
	databaseUrl: string | undefined,
	caCert: string | undefined
): SmokePreconditions {
	if (!databaseUrl) {
		return {
			ok: false,
			reason:
				'DATABASE_URL is not set. Run this against the provisioned instance; a smoke check with nothing to connect to proves nothing.',
		}
	}

	let host: string
	try {
		host = new URL(databaseUrl).hostname.toLowerCase()
	} catch {
		return { ok: false, reason: 'DATABASE_URL is not a parseable URL.' }
	}

	if (!isRelaxedDbEnv(nodeEnv) && !isEuSovereignDbHost(host)) {
		return {
			ok: false,
			reason: `"${host}" is not a DanubeData EU host (CLOUD Act immunity). Expected the internal writer name or a *.danubedata.ro host.`,
		}
	}

	return { ok: true, host, ssl: buildDbSsl(nodeEnv, caCert) }
}
