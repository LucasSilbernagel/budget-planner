// @ts-check
/**
 * The migrate container's status server (Story 5-18, AC-3).
 *
 * This is the pipeline's only verdict channel, and it exists because readiness
 * cannot carry a verdict. If `/healthz` only went green on a SUCCESSFUL
 * migration, then "the migration failed", "the image is broken", "the pod is
 * crash-looping" and "it is merely slow" would all present as the same thing: a
 * `--wait` timeout. So readiness answers *did the container boot*, and this
 * endpoint answers *what happened* — positively, on a bound, failing closed.
 *
 * Deliberately NOT log-scraping. `danube rapids logs` returns an envelope with
 * `available: false` when the log backend is down, and the CLI's own wording for
 * that case is "Logs are currently unavailable. This says nothing about the
 * container itself." A verdict that can silently become unreadable is not a
 * verdict; logs stay a diagnostic.
 *
 * The container is publicly routable for the few minutes it exists, so the
 * status endpoint is bearer-gated with a per-run token and the listener refuses
 * to be constructed without one.
 */

import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

const DEFAULT_HEALTH_PATH = '/healthz'
const STATUS_PATH = '/migrate-status'

/**
 * Constant-time bearer comparison that tolerates a length mismatch.
 *
 * `timingSafeEqual` THROWS on differing lengths, which would surface as a 500
 * and read exactly like a broken container — so length is checked first and a
 * mismatch is simply "no".
 *
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
 * @returns {string | null} the presented token, or null if the header is absent or malformed
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
 * A health endpoint and nothing else, for a migrate container with no work to do.
 *
 * ⚠️ THIS EXISTS BECAUSE OF A CRASH LOOP. 2026-09-16.
 *
 * The migrate container is permanent, and between releases its credentials are
 * stripped (`--rm-env`) while `APP_ENTRYPOINT=migrate` stays set. The entrypoint
 * used to `process.exit(1)` when `MIGRATE_STATUS_TOKEN` was missing — a sound
 * instinct for a container that is *supposed* to migrate, but wrong for one that
 * is deliberately idle: Knative started revision `budget-planner-migrator-00005`,
 * it exited 1 four times, and the platform reported `CrashLoopBackOff` and emailed
 * a provisioning failure. The container was doing exactly what it was told; the
 * design just had no way to say "nothing to do right now".
 *
 * So an unconfigured migrate container now STARTS and stays healthy, and serves
 * NO status endpoint at all — there is no token to guard one with, and a status
 * endpoint with nothing to report has nothing to gain by existing. It never
 * migrates: that still requires a full, explicit configuration.
 *
 * Safety is unchanged. The pipeline only ever accepts a verdict that carries its
 * own run id; an idle container returns 404 there, the poll times out, and the
 * release fails closed — which is the same outcome the old `exit(1)` produced,
 * minus the crash loop and the false alarm.
 *
 * @param {object} options
 * @param {string} [options.healthPath]
 * @returns {import('node:http').RequestListener}
 */
export function createIdleHealthListener({ healthPath = DEFAULT_HEALTH_PATH } = {}) {
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
 * @param {object} options
 * @param {string | undefined} options.token per-run secret, minted by the pipeline
 * @param {() => Record<string, unknown>} options.readState current verdict snapshot
 * @param {string} [options.healthPath] must match the container's `--health-check-path`
 * @returns {import('node:http').RequestListener}
 */
export function createMigrateStatusListener({
  token,
  readState,
  healthPath = DEFAULT_HEALTH_PATH,
}) {
  // Refuse at CONSTRUCTION, not per request: without a token this endpoint would
  // be an open description of the production database's migration state. A
  // container that fails to boot is a loud, diagnosable failure; one that comes
  // up unguarded is a silent one.
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

    // ⚠️ MUST be inside a try/catch, and this is not defensive padding: Node's
    // HTTP parser accepts absolute-form request targets whose authority the
    // WHATWG URL parser rejects — `GET http://a:99999/`, `GET http://a:b/`,
    // `GET http://[/` are all delivered to this listener verbatim (verified
    // against Node directly, 2026-09-15), and `new URL()` throws on each. An
    // exception escaping a request listener is an UNCAUGHT exception: the process
    // exits, taking the running `drizzle-kit migrate` child with it, and this
    // container is publicly routable with its URL printed in the run log. So a
    // stray scanner could otherwise kill a migration mid-flight.
    let pathname
    try {
      // A relative URL needs a base to parse; the authority is irrelevant here and
      // parsing is what normalises `/migrate-status/../healthz` away from a match.
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
