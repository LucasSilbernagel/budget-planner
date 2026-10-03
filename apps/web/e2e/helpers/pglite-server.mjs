/**
 * The database behind the `chromium-db` project (story 87.1, F9; decision D1).
 *
 * A PGlite instance with the REAL migration chain applied, served over the
 * Postgres wire protocol by `@electric-sql/pglite-socket`, so the `:5176` dev
 * server reaches it through its ordinary `pg` pool and `DATABASE_URL`. No
 * Docker, no service container: local gates and CI run the same thing.
 *
 * Playwright starts this as a `webServer` (`playwright.config.ts`), so it
 * starts and stops with the run. Every start is a FRESH, empty database
 * (`reuseExistingServer: false`): the rate-limit buckets, login tokens and the
 * seeded user never carry over from an earlier run.
 *
 * It also seeds the one user F9 signs in as (decision D3: accounts are created
 * by the Paddle webhook, which is F10's path) and truncates the mail outbox
 * (decision D2), so the outbox only ever holds this run's links.
 *
 * Configured by the environment `playwright.config.ts` passes it:
 *   E2E_DB_PORT, E2E_DB_SEED_EMAIL, E2E_DB_SEED_PADDLE_ID, E2E_MAIL_OUTBOX
 *
 * Plain `.mjs`, not TypeScript: written when CI ran Node 20, which cannot run
 * `.ts`. CI is on Node 24 now (PR #22); `.mjs` still needs no loader.
 * The migration loader mirrors `src/test/pglite-migrated.ts` (the drizzle-kit
 * journal in index order, split on `--> statement-breakpoint`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

function required(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`[e2e-db] ${name} is not set (playwright.config.ts passes it)`)
    process.exit(2)
  }
  return value
}

const port = Number(required('E2E_DB_PORT'))
const seedEmail = required('E2E_DB_SEED_EMAIL')
const seedPaddleId = required('E2E_DB_SEED_PADDLE_ID')
const outbox = required('E2E_MAIL_OUTBOX')

const MIGRATIONS = new URL('../../../../packages/db/migrations/', import.meta.url)

/**
 * Story ops-2 (D3): the session TimeZone the database must run in, and the only
 * value the self-check below accepts (what `SET TimeZone TO 'UTC'` reports,
 * MEASURED). Without the pin PGlite inherits the HOST zone as a fixed standard
 * offset (an EDT box read `Etc/GMT+5`), so a `DEFAULT now()` timestamp was hours
 * off an app-written `toISOString()` one (87.2's "~5 h createdAt shift").
 * Production pins every connection to UTC (`DB_SESSION_OPTIONS`); pglite-socket
 * ignores startup `options`, so the pin here is a `SET` on the ONE shared PGlite
 * session, which every socket connection sees.
 */
const UTC_ZONES = ['UTC']

async function migrated() {
  const pg = await PGlite.create()
  // Before migrations and the seed, so every DB-side now() is UTC wall time.
  await pg.exec("SET TimeZone TO 'UTC'")
  const journal = JSON.parse(
    readFileSync(fileURLToPath(new URL('meta/_journal.json', MIGRATIONS)), 'utf8')
  )
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx)
  // Non-vacuity: a wrong path would give an empty journal and an empty schema,
  // and F9 would then fail far away with "relation does not exist".
  if (entries.length === 0) throw new Error('[e2e-db] the migration journal is empty')
  for (const entry of entries) {
    const sql = readFileSync(fileURLToPath(new URL(`${entry.tag}.sql`, MIGRATIONS)), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await pg.exec(statement)
    }
  }
  return { pg, migrations: entries.length }
}

const { pg, migrations } = await migrated()

// The F9 account: `active`, so the paid chrome is the visible proof of sign-in.
await pg.query(
  `INSERT INTO "users" ("email", "paddleId", "subscriptionStatus") VALUES ($1, $2, 'active')`,
  [seedEmail, seedPaddleId]
)

// Self-check before listening: a harness that would hand out a non-UTC clock
// refuses to start, rather than letting F9/F10 run on shifted timestamps.
const timeZone = (await pg.query(`SELECT current_setting('TimeZone') AS tz`)).rows[0]?.tz
if (!UTC_ZONES.includes(timeZone)) {
  console.error(
    `[e2e-db] session TimeZone is ${JSON.stringify(timeZone)}, expected one of ${UTC_ZONES.join(
      ', '
    )} (story ops-2)`
  )
  process.exit(3)
}

mkdirSync(dirname(outbox), { recursive: true })
writeFileSync(outbox, '')

const server = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1', maxConnections: 20 })
server.addEventListener('error', (event) => {
  console.error('[e2e-db] socket server error', event.detail ?? event)
})
await server.start()
console.log(
  `[e2e-db] ${migrations} migrations applied, 1 user seeded, TimeZone=${timeZone}, listening on 127.0.0.1:${port}`
)

let stopping = false
async function stop(signal) {
  if (stopping) return
  stopping = true
  try {
    await server.stop()
    await pg.close()
  } finally {
    console.log(`[e2e-db] stopped (${signal})`)
    process.exit(0)
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop(signal))
