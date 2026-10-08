// @ts-check
// Binds $PORT first so Knative marks the revision Ready, then keeps serving
// /migrate-status: Knative treats an exiting container as a failed revision.

// Must never import the built application server.

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { MIGRATION_STEPS, runMigration } from './src/server/migrate-runner.mjs'
import {
  createIdleHealthListener,
  createMigrateStatusListener,
} from './src/server/migrate-status.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const dbPackageDir = join(here, '..', '..', 'packages', 'db')

const DEFAULT_PORT = 8080
const SHUTDOWN_TIMEOUT_MS = 10_000

// A bad $PORT makes listen() throw synchronously, past the `error` handler.
/**
 * @param {string | undefined} raw
 * @returns {number}
 */
function parsePort(raw) {
  const parsed = Number(raw)
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed
  }
  if (raw !== undefined && raw !== '') {
    console.warn(`[migrate-entry] invalid PORT "${raw}"; falling back to ${DEFAULT_PORT}`)
  }
  return DEFAULT_PORT
}

/** @type {Record<string, unknown> & { state: 'running' | 'succeeded' | 'failed' }} */
const status = {
  state: 'running',
  startedAt: new Date().toISOString(),
}

/** Signalled on shutdown rather than orphaned against production. */
let activeChild = null

// Resolved by path: the image runs node with no pnpm shim, so PATH can't find these.
/**
 * @param {{ name: string, bin: string, args: string[] }} step
 * @returns {Promise<number | null>}
 */
function runStep(step) {
  const bin = join(dbPackageDir, 'node_modules', '.bin', step.bin)
  console.log(`[migrate-entry] running ${step.name}: ${step.bin} ${step.args.join(' ')}`)

  return new Promise((resolve, reject) => {
    const child = spawn(bin, step.args, {
      cwd: dbPackageDir,
      stdio: 'inherit',
      env: process.env,
    })
    activeChild = child
    const done = () => {
      if (activeChild === child) {
        activeChild = null
      }
    }
    child.on('error', (error) => {
      done()
      reject(error)
    })
    child.on('close', (code) => {
      done()
      resolve(code)
    })
  })
}

function readEnv(/** @type {string} */ name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

// The pipeline parses this line. Logs aggregate across revisions, unlike the URL
// Knative may route to a successor. Never put a credential in it.
/**
 * @param {{ state: string, failedStep?: string, exitCode?: number | null }} result
 */
function emitVerdict(result) {
  const parts = [`run=${runId}`, `state=${result.state}`]
  if (result.state !== 'succeeded') {
    parts.push(`step=${result.failedStep ?? 'unknown'}`, `code=${result.exitCode ?? 'null'}`)
  }
  console.log(`[migrate-entry] VERDICT ${parts.join(' ')}`)
}

// Missing configuration means idle, not a crash: between releases the pipeline strips
// the credentials but leaves the container running. All three are required together.
const token = readEnv('MIGRATE_STATUS_TOKEN')
const databaseUrl = readEnv('DATABASE_URL')
const runId = readEnv('MIGRATE_RUN_ID')

const port = parsePort(process.env['PORT'])
const healthPath = process.env['MIGRATE_HEALTH_PATH'] || '/healthz'

if (!token || !databaseUrl || !runId) {
  // Idle: serve health only, never migrate.
  const missing = [
    !token && 'MIGRATE_STATUS_TOKEN',
    !databaseUrl && 'DATABASE_URL',
    !runId && 'MIGRATE_RUN_ID',
  ].filter(Boolean)

  console.warn(`[migrate-entry] IDLE — not configured to migrate (missing: ${missing.join(', ')}).`)
  console.warn('[migrate-entry] Serving health only. No migration will run, no status exposed.')

  const idleServer = createServer(createIdleHealthListener({ healthPath }))
  idleServer.on('error', (err) => {
    console.error('[migrate-entry] HTTP server error:', err)
    process.exit(1)
  })
  idleServer.listen(port, '0.0.0.0', () => {
    console.log(`[migrate-entry] idle health server listening on 0.0.0.0:${port}`)
  })
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.on(signal, () => {
      console.log(`[migrate-entry] ${signal} received while idle; exiting.`)
      idleServer.close(() => process.exit(0))
    })
  }
} else {
  status['runId'] = runId

  const httpServer = createServer(
    createMigrateStatusListener({ token, healthPath, readState: () => ({ ...status }) })
  )

  httpServer.on('error', (err) => {
    console.error('[migrate-entry] HTTP server error:', err)
    process.exit(1)
  })

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(
      `[migrate-entry] status server listening on 0.0.0.0:${port} (health ${healthPath}, run ${runId})`
    )
    console.log(`[migrate-entry] steps: ${MIGRATION_STEPS.map((s) => s.name).join(' -> ')}`)

    runMigration({ runStep }).then(
      (result) => {
        Object.assign(status, result, { finishedAt: new Date().toISOString() })
        emitVerdict(result)
        if (result.state === 'succeeded') {
          console.log('[migrate-entry] MIGRATION SUCCEEDED. Holding the status endpoint open.')
        } else {
          console.error(`[migrate-entry] MIGRATION FAILED at ${result.failedStep}: ${result.error}`)
        }
      },
      (error) => {
        // Defence in depth: the verdict must become terminal, or the pipeline polls
        // `running` until its deadline and reports a timeout.
        Object.assign(status, {
          state: 'failed',
          failedStep: 'unknown',
          exitCode: null,
          error: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        })
        emitVerdict({ state: 'failed', failedStep: 'unknown', exitCode: null })
        console.error('[migrate-entry] MIGRATION FAILED (unexpected):', error)
      }
    )
  })

  // Drain rather than close(): queue-proxy holds keep-alive sockets open. Signal the
  // running step too, or an orphaned drizzle-kit keeps issuing DDL against production.
  let shuttingDown = false
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.on(signal, () => {
      if (shuttingDown) {
        return
      }
      shuttingDown = true
      console.log(`[migrate-entry] ${signal} received; state=${status['state']}; draining…`)

      if (activeChild) {
        console.warn(`[migrate-entry] signalling the in-flight step with ${signal}`)
        activeChild.kill(signal)
      }

      httpServer.close(() => process.exit(0))
      httpServer.closeIdleConnections()
      setTimeout(() => {
        console.warn('[migrate-entry] drain timed out; forcing exit')
        process.exit(1)
      }, SHUTDOWN_TIMEOUT_MS).unref()
    })
  }
}
