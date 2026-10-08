// PGlite with the real migration chain, served over the Postgres wire protocol so
// the dev server reaches it through its ordinary pg pool. Fresh on every start.
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

// Unpinned, PGlite inherits the host zone as a fixed offset (e.g. Etc/GMT+5).
// pglite-socket ignores startup options, so SET it on the one shared session.
const UTC_ZONES = ['UTC']

async function migrated() {
  const pg = await PGlite.create()
  // Before migrations and the seed, so every DB-side now() is UTC wall time.
  await pg.exec("SET TimeZone TO 'UTC'")
  const journal = JSON.parse(
    readFileSync(fileURLToPath(new URL('meta/_journal.json', MIGRATIONS)), 'utf8')
  )
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx)
  // Non-vacuity: a wrong path gives an empty journal and a confusing failure later.
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

// `active`, so the paid chrome is the visible proof of sign-in.
await pg.query(
  `INSERT INTO "users" ("email", "paddleId", "subscriptionStatus") VALUES ($1, $2, 'active')`,
  [seedEmail, seedPaddleId]
)

// Refuse to start rather than hand out a non-UTC clock.
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
