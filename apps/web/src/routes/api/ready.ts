/**
 * Readiness Route
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Endpoint: GET /api/ready
 *
 * Readiness probe — answers "can this instance serve traffic that needs the DB?".
 * Reuses `testDbConnection()` (lazy/safe, NFR8) and maps the result to 200/503.
 * This is the endpoint Rapids/Knative's readiness probe is pointed at (story 5-2
 * AC-2 references this path). Returns a minimal payload only — it never leaks the
 * underlying error, versions, stack, or secrets (story 5-5 AC-1).
 */

import { testDbConnection } from '@budget-planner/db'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/** Max time to wait on the DB check before declaring the instance not-ready. */
const READINESS_TIMEOUT_MS = 2000

export const GET = async (): Promise<Response> => {
  let dbOk = false
  try {
    // Race the check against a timeout: a black-hole DB (unreachable but not
    // refusing) can leave pool.connect() pending forever, which would hang the
    // probe. Time-bounding it makes an unresponsive DB fail closed to 503.
    dbOk = await Promise.race([
      testDbConnection(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), READINESS_TIMEOUT_MS)),
    ])
  } catch {
    // testDbConnection already fails closed, but guard the boundary so a probe
    // request can never throw / 500 — an unready instance answers 503, not crash.
    dbOk = false
  }

  return dbOk
    ? json({ status: 'ready' }, { status: 200 })
    : json({ status: 'not-ready' }, { status: 503 })
}

export const Route = createFileRoute('/api/ready')({
  server: {
    handlers: {
      GET,
    },
  },
})
