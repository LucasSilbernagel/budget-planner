import { testDbConnection } from '@budget-planner/db'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

const READINESS_TIMEOUT_MS = 2000

export const GET = async (): Promise<Response> => {
  let dbOk = false
  try {
    // A black-hole DB can leave `pool.connect()` pending forever; time-bound it to fail
    // closed to 503.
    dbOk = await Promise.race([
      testDbConnection(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), READINESS_TIMEOUT_MS)),
    ])
  } catch {
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
