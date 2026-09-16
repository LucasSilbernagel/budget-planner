// @ts-check
/**
 * Production MIGRATE entrypoint (Story 5-18, AC-1..AC-4).
 *
 * Replaces the ADR-001 time-boxed exception: instead of opening the database's
 * public DNS so a GitHub runner can reach it, the app image is started as a
 * Rapids container in the same cluster and namespace, where the database's
 * in-cluster name resolves and its certificate actually matches — so the
 * migration runs over `verify-full` TLS with no public endpoint at any point.
 *
 * Shape of this process (story D3/D4/D7):
 *   1. Bind `$PORT` FIRST and answer the health path, so Knative marks the
 *      revision Ready promptly. Readiness means "the container booted" — never
 *      "the migration succeeded".
 *   2. Run preflight → `drizzle-kit migrate` and record a terminal verdict.
 *   3. Keep serving `/migrate-status` so the pipeline can read that verdict.
 *      Do NOT exit: Knative Serving treats a container that runs and exits as a
 *      failed revision, which would be indistinguishable from a crash-loop. The
 *      pipeline deletes the container in an `if: always()` step instead.
 *
 * Re-entrancy: if Knative restarts the pod anyway, the preflight re-runs and
 * `drizzle-kit migrate` is journal-driven, so the restart re-verifies and
 * applies nothing.
 *
 * ⚠️ This module must never import the built application server. The migrate
 * process owns no routes at all — see `src/server/entrypoint.mjs`.
 */

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
/** Both steps run here: `drizzle.config.ts` and `migrations/` live in this package. */
const dbPackageDir = join(here, '..', '..', 'packages', 'db')

const DEFAULT_PORT = 8080
const SHUTDOWN_TIMEOUT_MS = 10_000

/**
 * Parse `$PORT` to a valid TCP port, falling back to 8080. Same guard
 * `serve-entry.mjs` carries, and for the same reason: a non-numeric value or an
 * out-of-range one makes `listen()` throw SYNCHRONOUSLY — past the `error`
 * handler, which only catches asynchronous bind failures — so the container
 * crash-loops with an unhelpful stack instead of a stated reason.
 *
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

/** The spawned step, so shutdown can signal it rather than orphan it against production. */
let activeChild = null

/**
 * Spawn one step from the db package's own `node_modules/.bin`.
 *
 * Resolved by path rather than by relying on `PATH`: the image runs `node`
 * directly with no pnpm shim in scope, so the bin directory is the only place
 * these binaries are reachable from.
 *
 * @param {{ name: string, bin: string, args: string[] }} step
 * @returns {Promise<number | null>}
 */
function runStep(step) {
  const bin = join(dbPackageDir, 'node_modules', '.bin', step.bin)
  console.log(`[migrate-entry] running ${step.name}: ${step.bin} ${step.args.join(' ')}`)

  return new Promise((resolve, reject) => {
    const child = spawn(bin, step.args, {
      cwd: dbPackageDir,
      // Inherited so the step's own output lands in `danube rapids logs`, where
      // it is the diagnostic record for a failure. The verdict itself travels
      // over /migrate-status, not through these logs.
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

// ⚠️ MISSING CONFIGURATION IS "NOTHING TO DO", NOT A CRASH. Changed 2026-09-16.
//
// This used to `process.exit(1)` on a missing variable. That is right for a
// container whose job is to migrate NOW, and wrong for this one: the container is
// permanent, and between releases the pipeline deliberately strips its credentials
// while leaving `APP_ENTRYPOINT=migrate` set. Knative then started it, it exited 1
// four times, and the platform reported `CrashLoopBackOff` and emailed a
// provisioning failure (revision `budget-planner-migrator-00005`). Nothing was
// wrong — the container simply had no way to say "idle".
//
// `MIGRATE_RUN_ID` is what binds this process to the pipeline run that started it:
// the pipeline accepts a verdict only when the id matches the one it minted, so a
// container carrying a stale but well-formed `succeeded` can never be mistaken for
// the current run's. All three are required TOGETHER — a partial set is not a
// configuration, it is a mistake, and migrating on it would be worse than idling.
const token = readEnv('MIGRATE_STATUS_TOKEN')
const databaseUrl = readEnv('DATABASE_URL')
const runId = readEnv('MIGRATE_RUN_ID')

const port = parsePort(process.env['PORT'])
const healthPath = process.env['MIGRATE_HEALTH_PATH'] || '/healthz'

if (!token || !databaseUrl || !runId) {
  // IDLE. Serve health, nothing else, and never migrate. Everything below this
  // branch is the configured path and is deliberately not reached.
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
        if (result.state === 'succeeded') {
          console.log('[migrate-entry] MIGRATION SUCCEEDED. Holding the status endpoint open.')
        } else {
          console.error(`[migrate-entry] MIGRATION FAILED at ${result.failedStep}: ${result.error}`)
        }
      },
      (error) => {
        // Defence in depth: runMigration already converts a thrown step into a
        // verdict, so reaching here means something outside the steps failed. The
        // verdict must still become terminal, or the pipeline would poll `running`
        // until its deadline and report a timeout instead of a failure.
        Object.assign(status, {
          state: 'failed',
          failedStep: 'unknown',
          exitCode: null,
          error: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        })
        console.error('[migrate-entry] MIGRATION FAILED (unexpected):', error)
      }
    )
  })

  // The pipeline scales this container down; SIGTERM is that arriving.
  //
  // Mirrors `serve-entry.mjs`'s drain rather than a bare `close()`: Knative's
  // queue-proxy holds keep-alive sockets open, so `close()`'s callback would never
  // fire and the process would sit until SIGKILL. The running step is signalled
  // too — an orphaned `drizzle-kit` would otherwise keep issuing DDL against
  // production after the container it belongs to has been told to go away.
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
