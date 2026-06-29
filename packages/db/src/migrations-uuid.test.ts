/**
 * Migration integration test — entity serial→uuid conversion (Story 5-14, AC-2/AC-3).
 *
 * Proves the corrected migration chain (0000 → 0001 → 0002 → 0003) applies on a
 * POPULATED database without data loss and with foreign-key integrity preserved:
 * it seeds integer-keyed rows + FKs under the old schema, runs the conversion, and
 * asserts row counts, id types, the profileId backfill, and FK integrity.
 *
 * INFRA-GATED: requires a reachable PostgreSQL. Set MIGRATION_TEST_DATABASE_URL to
 * run it (e.g. a local dev DB); the test creates and drops an isolated throwaway
 * SCHEMA, so it never touches any real tables. Skipped by default so the normal
 * `pnpm --filter db test` (and CI without a DB) stays green.
 *
 * Local run:
 *   MIGRATION_TEST_DATABASE_URL=postgresql://USER@localhost:5432/SOME_DB \
 *     pnpm --filter db exec vitest run src/migrations-uuid.test.ts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB_URL = process.env.MIGRATION_TEST_DATABASE_URL

function migrationSql(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), 'utf8')
}

/** Run a whole migration file: split on drizzle's statement breakpoints so DO $$
 * blocks stay intact, then execute each statement in order. */
async function runMigration(client: Client, file: string): Promise<void> {
  const statements = migrationSql(file)
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  for (const statement of statements) {
    await client.query(statement)
  }
}

// user1 owns a default + secondary profile and one row of every entity type.
// user2 owns financial rows but NO profile — the populated-DB case that the 0001
// auto-create-default backfill (review P1) must handle without aborting.
const USER1 = '11111111-1111-1111-1111-111111111111'
const USER2 = '22222222-2222-2222-2222-222222222222'

const SEED_SQL = `
INSERT INTO users (id, email, "paddleId", "subscriptionStatus", currency)
VALUES
  ('${USER1}','a@test.com','pad_a','active','USD'),
  ('${USER2}','b@test.com','pad_b','active','EUR');

INSERT INTO "userProfiles" ("userId", name, "isDefault", currency, "createdAt")
VALUES
  ('${USER1}','Default', true,  'USD', now() - interval '2 days'),
  ('${USER1}','Secondary', false,'USD', now() - interval '1 day');

INSERT INTO "incomeSources" ("userId", name, amount, frequency)
VALUES
  ('${USER1}','Salary', 500000, 'monthly'),
  ('${USER1}','Side gig', 100000, 'weekly'),
  ('${USER2}','U2 Salary', 300000, 'monthly');

INSERT INTO expenses ("userId", name, amount, frequency)
VALUES
  ('${USER1}','Rent', 200000, 'monthly'),
  ('${USER2}','U2 Rent', 120000, 'monthly');

INSERT INTO "savingsGoals" ("userId", name, "targetAmount", "currentBalance")
VALUES ('${USER1}','Car', 1000000, 50000);

INSERT INTO "balanceTracking" ("userId", type, name, "currentBalance", "monthlyContribution")
VALUES ('${USER1}','investment','401k', 300000, 10000);
`

const describeIfDb = TEST_DB_URL ? describe : describe.skip

describeIfDb('Migration 0000→0003 on a populated DB (Story 5-14)', () => {
  const schema = `mig_test_${Math.random().toString(36).slice(2, 10)}`
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB_URL })
    await client.connect()
    // Isolate everything in a throwaway schema so real tables are never touched.
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)

    await runMigration(client, '0000_rare_johnny_storm.sql') // old serial-keyed schema
    await client.query(SEED_SQL) // integer-keyed rows + FKs
    await runMigration(client, '0001_chilly_princess_powerful.sql') // userProfiles uuid + profileId backfill
    await runMigration(client, '0002_tearful_grim_reaper.sql') // isDeleted tombstones
    await runMigration(client, '0003_kind_risque.sql') // entity serial → uuid
  })

  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await client.end()
    }
  })

  async function count(table: string): Promise<number> {
    const r = await client.query(`SELECT count(*)::int AS n FROM "${table}"`)
    return r.rows[0].n
  }

  async function idType(table: string): Promise<string> {
    const r = await client.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = 'id'`,
      [schema, table]
    )
    return r.rows[0]?.data_type
  }

  it('AC-2: preserves every row (no data loss)', async () => {
    expect(await count('users')).toBe(2)
    // 2 seeded for user1 + 1 auto-created default for user2 (review P1) = 3; the
    // extra row is an intentional addition, not lost/duplicated data.
    expect(await count('userProfiles')).toBe(3)
    expect(await count('incomeSources')).toBe(3)
    expect(await count('expenses')).toBe(2)
    expect(await count('savingsGoals')).toBe(1)
    expect(await count('balanceTracking')).toBe(1)
  })

  it('P1: auto-creates a default profile for a user with rows but no profile', async () => {
    // user2 owned income/expense rows but no userProfiles row; the 0001 backfill
    // must mint a default so `profileId SET NOT NULL` cannot abort.
    const created = await client.query(
      `SELECT name, "isDefault" FROM "userProfiles" WHERE "userId" = $1`,
      [USER2]
    )
    expect(created.rows).toHaveLength(1)
    expect(created.rows[0].name).toBe('Main Profile')
    expect(created.rows[0].isDefault).toBe(true)

    // user2's rows are backfilled to ITS OWN new default (not user1's).
    const u2Income = await client.query(
      `SELECT bool_and(i."profileId" = dp.id) AS ok
       FROM "incomeSources" i
       JOIN "userProfiles" dp ON dp."userId" = i."userId" AND dp."isDefault"
       WHERE i."userId" = $1`,
      [USER2]
    )
    expect(u2Income.rows[0].ok).toBe(true)

    // user1 keeps exactly its 2 original profiles — no spurious default created.
    expect(
      (
        await client.query(`SELECT count(*)::int AS n FROM "userProfiles" WHERE "userId" = $1`, [
          USER1,
        ])
      ).rows[0].n
    ).toBe(2)
  })

  it('AC-1: the four entity PKs are now uuid', async () => {
    expect(await idType('incomeSources')).toBe('uuid')
    expect(await idType('expenses')).toBe('uuid')
    expect(await idType('savingsGoals')).toBe('uuid')
    expect(await idType('balanceTracking')).toBe('uuid')
    expect(await idType('userProfiles')).toBe('uuid')
  })

  it('AC-2: every row got a non-null, distinct uuid id', async () => {
    const r = await client.query(
      `SELECT count(*)::int AS total, count(DISTINCT id)::int AS distinct_ids,
              count(*) FILTER (WHERE id IS NULL)::int AS nulls
       FROM "incomeSources"`
    )
    expect(r.rows[0].total).toBe(3)
    expect(r.rows[0].distinct_ids).toBe(3)
    expect(r.rows[0].nulls).toBe(0)
  })

  it("AC-3: profileId backfilled to each row's own default profile with no orphans", async () => {
    // Per-user: every income row points at ITS user's default profile (robust to
    // multiple users, each with their own default).
    const allDefault = await client.query(
      `SELECT bool_and(i."profileId" = dp.id) AS ok
       FROM "incomeSources" i
       JOIN "userProfiles" dp ON dp."userId" = i."userId" AND dp."isDefault"`
    )
    expect(allDefault.rows[0].ok).toBe(true)

    const orphanProfile = await client.query(
      `SELECT count(*)::int AS n FROM "incomeSources" i
       LEFT JOIN "userProfiles" p ON i."profileId" = p.id WHERE p.id IS NULL`
    )
    expect(orphanProfile.rows[0].n).toBe(0)

    const orphanUser = await client.query(
      `SELECT count(*)::int AS n FROM "incomeSources" i
       LEFT JOIN users u ON i."userId" = u.id WHERE u.id IS NULL`
    )
    expect(orphanUser.rows[0].n).toBe(0)
  })

  it('AC-2: monetary values are intact after conversion', async () => {
    const r = await client.query(`SELECT amount FROM "incomeSources" WHERE name = 'Salary'`)
    expect(r.rows[0].amount).toBe(500000)
  })

  it('AC-1: a client-supplied uuid insert succeeds', async () => {
    await client.query(
      `INSERT INTO "incomeSources" (id, "userId", "profileId", name, amount, frequency)
       SELECT '99999999-9999-9999-9999-999999999999', "userId", "profileId", 'ClientRow', 12345, 'monthly'
       FROM "incomeSources" LIMIT 1`
    )
    const r = await client.query(
      `SELECT count(*)::int AS n FROM "incomeSources" WHERE id = '99999999-9999-9999-9999-999999999999'`
    )
    expect(r.rows[0].n).toBe(1)
  })
})
