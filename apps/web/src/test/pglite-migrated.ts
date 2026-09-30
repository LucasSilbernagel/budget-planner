/**
 * A PGlite database with the real migration chain applied (story 83.1).
 *
 * The same loader the `*.db.test.ts` files inline (e.g.
 * `server/functions/__tests__/forecastingProfiles.create-race.db.test.ts`):
 * the drizzle-kit journal, in index order, split on `--> statement-breakpoint`.
 * Shared here so the new route and chain tests do not add three more copies.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS = new URL('../../../../packages/db/migrations/', import.meta.url)

export async function migratedPglite(): Promise<PGlite> {
  const pg = new PGlite()
  const journal = JSON.parse(
    readFileSync(fileURLToPath(new URL('meta/_journal.json', MIGRATIONS)), 'utf8')
  ) as { entries: { idx: number; tag: string }[] }
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sql = readFileSync(fileURLToPath(new URL(`${entry.tag}.sql`, MIGRATIONS)), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) {
        await pg.exec(statement)
      }
    }
  }
  return pg
}
