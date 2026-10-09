// @ts-check
/**
 * The pipeline's only verdict channel: readiness can't tell failed from slow, and logs
 * can be silently unavailable. Bearer-gated because the container is publicly routable.
 */

import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

const DEFAULT_HEALTH_PATH = '/healthz'
const STATUS_PATH = '/migrate-status'

/**
 * timingSafeEqual throws on differing lengths (a 500), so length is checked first.
 * @param {string} presented
 * @param {string} expected
 */
function tokenMatches(presented, expected) {
	const a = Buffer.from(presented, 'utf8')
	const b = Buffer.from(expected, 'utf8')
	if (a.length !== b.length) {
		return false
	}
	return timingSafeEqual(a, b)
}

/**
 * @param {string | undefined} header
 * @returns {string | null}
 */
function readBearer(header) {
	if (typeof header !== 'string') {
		return null
	}
	// Case-insensitive scheme per RFC 7235; exactly one space, no other schemes.
	const match = /^Bearer (.+)$/i.exec(header)
	return match ? match[1] : null
}

/**
 * For an idle migrate container (credentials stripped between releases): stays healthy
 * instead of crash-looping, never migrates, serves no status endpoint.
 */
export function createIdleHealthListener({ healthPath = DEFAULT_HEALTH_PATH } = {}) {
	/** @type {import('node:http').RequestListener} */
	return (request, response) => {
		let pathname
		try {
			;({ pathname } = new URL(request.url ?? '/', 'http://container.invalid'))
		} catch {
			pathname = ''
		}

		const body = JSON.stringify(
			pathname === healthPath ? { status: 'ok', state: 'idle' } : { error: 'not_found' }
		)
		response.writeHead(pathname === healthPath ? 200 : 404, {
			'content-type': 'application/json; charset=utf-8',
			'content-length': Buffer.byteLength(body),
			'cache-control': 'no-store',
		})
		response.end(body)
	}
}

/**
 * @param {{ token: string | undefined, readState: () => Record<string, unknown>, healthPath?: string }} options
 * @returns {import('node:http').RequestListener}
 */
export function createMigrateStatusListener({
	token,
	readState,
	healthPath = DEFAULT_HEALTH_PATH,
}) {
	// Refuse at construction: without a token this would openly describe the production
	// database's migration state.
	if (typeof token !== 'string' || token.trim() === '') {
		throw new Error(
			'MIGRATE_STATUS_TOKEN is not set. Refusing to expose the migration status endpoint without a bearer token.'
		)
	}

	return (request, response) => {
		const send = (/** @type {number} */ status, /** @type {unknown} */ body) => {
			const payload = JSON.stringify(body)
			response.writeHead(status, {
				'content-type': 'application/json; charset=utf-8',
				'content-length': Buffer.byteLength(payload),
				// Nothing here should ever be cached by an edge proxy.
				'cache-control': 'no-store',
			})
			response.end(payload)
		}

		// Must be in try/catch: Node's HTTP parser delivers absolute-form targets that new URL()
		// rejects, and an uncaught throw would kill the running migration.
		let pathname
		try {
			// Parsing normalises `/migrate-status/../healthz` away from a match.
			;({ pathname } = new URL(request.url ?? '/', 'http://container.invalid'))
		} catch {
			send(400, { error: 'bad_request' })
			return
		}

		if (pathname === healthPath) {
			// Open on purpose: Knative's readiness probe carries no credentials, and
			// this reveals only that a process is listening.
			send(200, { status: 'ok' })
			return
		}

		if (pathname !== STATUS_PATH) {
			send(404, { error: 'not_found' })
			return
		}

		if (request.method !== 'GET') {
			send(405, { error: 'method_not_allowed' })
			return
		}

		const presented = readBearer(request.headers.authorization)
		if (presented === null || !tokenMatches(presented, token)) {
			// No state in the body: an unauthenticated caller learns nothing about the
			// migration beyond the fact that this endpoint exists.
			send(401, { error: 'unauthorized' })
			return
		}

		send(200, readState())
	}
}
