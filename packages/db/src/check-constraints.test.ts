/**
 * The declared CHECK constraints are enforced by a real database (Story 66.5, AC-4).
 *
 * `schema.ts` declares eight `check()` constraints. Until migration `0020` not one
 * of them existed in SQL — drizzle-kit 0.23 emits no CHECK DDL at all, so every
 * one was documentation that read like enforcement. This file is the proof that
 * they are enforcement now: each test asks PostgreSQL to store a row the
 * constraint forbids and asserts it refuses.
 *
 * ⚠️⚠️ WHY A REAL DATABASE AND NOT `.toSQL()`. A `.toSQL()` assertion proves only
 * that the code intends a statement; story 65.2's AC-5 CREATE leg is on record as
 * not having proven the thing it appeared to prove. PGlite is genuine PostgreSQL
 * compiled to WebAssembly, in-process, with no server and no credentials — so the
 * parser, the planner and the constraint machinery are the real ones.
 *
 * ⚠️ EACH ASSERTION PINS THE CONSTRAINT NAME, not merely "it threw". An INSERT can
 * fail for a dozen reasons that have nothing to do with the constraint under test
 * — a NOT NULL column, a foreign key, an enum label — and a bare `.rejects.toThrow()`
 * passes for every one of them. `error.constraint` is what makes the test bite the
 * thing it claims to. ⚠️ `error.constraint`, NOT `error.constraint_name`: PGlite
 * follows node-postgres, and reading the wire-protocol spelling returns `undefined`
 * for every case. See {@link outcomeOf}, which is where that bug was found.
 *
 * ⚠️ `@electric-sql/pglite` is a devDependency of the WORKSPACE ROOT and must stay
 * there; see the note in `migration-replay.test.ts` for the 262-type-error
 * measurement behind that.
 *
 * Complements `migration-replay.test.ts`, which asserts the constraints EXIST with
 * the definitions `schema.ts` declares. That one asks whether they are there; this
 * one runs into them.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

interface JournalEntry {
  idx: number
  tag: string
}

const journal = JSON.parse(
  readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')
) as { entries: JournalEntry[] }

function migrationStatements(tag: string): string[] {
  const sql = readFileSync(
    fileURLToPath(new URL(`../migrations/${tag}.sql`, import.meta.url)),
    'utf8'
  )
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

const USER_ID = '11111111-1111-1111-1111-111111111111'
const PROFILE_ID = '22222222-2222-2222-2222-222222222222'

/**
 * The minimum valid graph every case below hangs off: one user and one profile,
 * both satisfying every constraint. Written once in `beforeAll` so a test that
 * fails does so because of ITS constraint and not because its fixtures are
 * missing. Columns are exactly the NOT NULL ones with no DB default.
 */
const SEED_SQL = `
INSERT INTO "users" (id, email, "paddleId")
VALUES ('${USER_ID}', 'checks@test.com', 'pad_checks');

INSERT INTO "userProfiles" (id, "userId", name)
VALUES ('${PROFILE_ID}', '${USER_ID}', 'Default');
`

let db: PGlite

beforeAll(async () => {
  db = await PGlite.create()
  // One transaction for the whole chain, mirroring drizzle's migrator and
  // `migration-replay.test.ts`.
  await db.exec('BEGIN')
  for (const entry of journal.entries) {
    for (const statement of migrationStatements(entry.tag)) {
      try {
        await db.exec(statement)
      } catch (error) {
        throw new Error(
          `Migration ${entry.tag} failed on statement:\n${statement}\n\n${(error as Error).message}`
        )
      }
    }
  }
  await db.exec('COMMIT')
  await db.exec(SEED_SQL)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

/** The row was stored — no constraint stood in its way. */
const ACCEPTED = 'ACCEPTED' as const

/**
 * Run one INSERT and name the outcome: the constraint that refused it, or
 * `ACCEPTED` if the database stored it.
 *
 * ⚠️⚠️ THE SENTINEL IS NOT DECORATION, and this helper is the reason. Its first
 * version returned `null` for "accepted" AND for "refused but unnamed", and read
 * the constraint from `error.constraint_name`. **PGlite does not populate that
 * field** — it follows node-postgres and calls it `error.constraint`
 * (`constraint_name` is the wire-protocol spelling, not the JS one). So every
 * case returned `null` whether the constraint existed or not, and the RED run
 * against `main` was red for the WRONG REASON: it would have stayed red after
 * the migration too. A distinct sentinel plus the throw below is what makes
 * "accepted" and "rejected" impossible to confuse.
 *
 * Each case runs in its own implicit transaction — PGlite's `query` autocommits —
 * so a rejected statement leaves no partial state and nothing here depends on
 * ordering between cases.
 */
async function outcomeOf(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params)
    return ACCEPTED
  } catch (error) {
    const e = error as { constraint?: string; code?: string; message?: string }
    // 23514 is `check_violation`. An INSERT can fail for a dozen unrelated
    // reasons — NOT NULL, a foreign key, an enum label — and each would otherwise
    // pass for "the constraint worked".
    if (e.code !== '23514') {
      throw new Error(`Expected a CHECK violation (23514) but got ${e.code}: ${e.message}`)
    }
    if (!e.constraint) {
      throw new Error(`CHECK violation carried no constraint name: ${e.message}`)
    }
    return e.constraint
  }
}

describe('CHECK constraints are enforced by the database (story 66.5)', () => {
  it('users_email_not_empty refuses an empty email', async () => {
    expect(
      await outcomeOf(`INSERT INTO "users" (email, "paddleId") VALUES ('', 'pad_empty_email')`)
    ).toBe('users_email_not_empty')
  })

  it('users_paddleId_not_empty refuses an empty paddleId', async () => {
    expect(
      await outcomeOf(
        `INSERT INTO "users" (email, "paddleId") VALUES ('empty-paddle@test.com', '')`
      )
    ).toBe('users_paddleId_not_empty')
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
  ])('incomeSources_amount_positive refuses a %s amount', async (_label, amount) => {
    expect(
      await outcomeOf(
        `INSERT INTO "incomeSources" ("userId", "profileId", name, amount, frequency)
         VALUES ($1, $2, 'Salary', $3, 'monthly')`,
        [USER_ID, PROFILE_ID, amount]
      )
    ).toBe('incomeSources_amount_positive')
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
  ])('expenses_amount_positive refuses a %s amount', async (_label, amount) => {
    expect(
      await outcomeOf(
        `INSERT INTO "expenses" ("userId", "profileId", name, amount, frequency)
         VALUES ($1, $2, 'Rent', $3, 'monthly')`,
        [USER_ID, PROFILE_ID, amount]
      )
    ).toBe('expenses_amount_positive')
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
  ])('savingsGoals_targetAmount_positive refuses a %s target', async (_label, targetAmount) => {
    expect(
      await outcomeOf(
        `INSERT INTO "savingsGoals" ("userId", "profileId", name, "targetAmount")
         VALUES ($1, $2, 'Car', $3)`,
        [USER_ID, PROFILE_ID, targetAmount]
      )
    ).toBe('savingsGoals_targetAmount_positive')
  })

  it('savingsGoals_targetAmount_positive ACCEPTS null (a goal-less savings account, story 16-1)', async () => {
    // A goal-less savings ACCOUNT stores `targetAmount = NULL` (story 16-1), and
    // this pins that the database still takes it. Worth having: it is the case a
    // careless tightening would break, and it would go red if someone replaced the
    // predicate with something genuinely null-hostile (`targetAmount IS NOT NULL
    // AND targetAmount > 0`, or a NOT NULL column).
    //
    // ⚠️⚠️ WHAT IT DOES **NOT** PROVE, corrected by code review — the original
    // comment here claimed "this case fails if the migration drops the null arm",
    // and that is FALSE. **A CHECK constraint is satisfied when its predicate is
    // NULL, not only when it is TRUE.** `NULL > 0` is NULL, so a bare
    // `CHECK ("targetAmount" > 0)` accepts a NULL target just as happily. MEASURED
    // against PGlite: bare `a > 0` accepts NULL and refuses 0. The `IS NULL OR`
    // arms in migration 0020 are therefore semantically REDUNDANT (harmless, and
    // kept because they state the intent that `schema.ts` declares).
    //
    // ⚠️ So the tripwire for a dropped null arm is NOT here — it is the predicate
    // TEXT comparison in `migration-replay.test.ts`, which diffs the constraint
    // definition against `schema.ts`. Behaviour cannot distinguish the two
    // predicates; only the text can. That is the reverse of the usual division of
    // labour between these two files, which is exactly why it is written down.
    expect(
      await outcomeOf(
        `INSERT INTO "savingsGoals" ("userId", "profileId", name, "targetAmount")
         VALUES ($1, $2, 'Emergency fund', NULL)`,
        [USER_ID, PROFILE_ID]
      )
    ).toBe(ACCEPTED)
  })

  it('savingsGoals_currentBalance_non_negative refuses a negative balance', async () => {
    expect(
      await outcomeOf(
        `INSERT INTO "savingsGoals" ("userId", "profileId", name, "currentBalance")
         VALUES ($1, $2, 'Overdrawn', -1)`,
        [USER_ID, PROFILE_ID]
      )
    ).toBe('savingsGoals_currentBalance_non_negative')
  })

  /**
   * ⚠️ THE ZERO-BOUNDARY CONTROLS, added by code review.
   *
   * Every `>= 0` constraint above is exercised with `-1` — and `> 0` refuses `-1`
   * too, so those cases alone cannot tell the two predicates apart. Zero is the
   * only value that distinguishes them behaviourally: `>= 0` must ACCEPT it and
   * `> 0` must refuse it. Without these three, a migration that tightened any of
   * the non-negative bounds to strictly-positive would pass this whole file while
   * silently refusing a brand-new savings account (balance 0), an account with no
   * manual allocation set to 0, or an asset row whose contribution is 0 — which
   * `BalancePage.tsx` writes deliberately for assets.
   */
  it.each([
    ['savingsGoals.currentBalance', `"currentBalance"`, 'Brand-new goal'],
    ['savingsGoals.monthlyAllocation', `"monthlyAllocation"`, 'No manual allocation'],
  ])('%s ACCEPTS zero (the bound is >= 0, not > 0)', async (_label, column, name) => {
    expect(
      await outcomeOf(
        `INSERT INTO "savingsGoals" ("userId", "profileId", name, ${column})
         VALUES ($1, $2, $3, 0)`,
        [USER_ID, PROFILE_ID, name]
      )
    ).toBe(ACCEPTED)
  })

  it('balanceTracking_monthlyContribution_non_negative ACCEPTS zero (assets are written as 0)', async () => {
    // `BalancePage.tsx` forces `monthlyContribution` to 0 for asset rows, so this
    // is not a hypothetical boundary — it is the value the form writes.
    expect(
      await outcomeOf(
        `INSERT INTO "balanceTracking" ("userId", "profileId", type, name, "monthlyContribution")
         VALUES ($1, $2, 'investment', 'Paid-off asset', 0)`,
        [USER_ID, PROFILE_ID]
      )
    ).toBe(ACCEPTED)
  })

  it('savingsGoals_monthlyAllocation_non_negative refuses a negative allocation', async () => {
    expect(
      await outcomeOf(
        `INSERT INTO "savingsGoals" ("userId", "profileId", name, "monthlyAllocation")
         VALUES ($1, $2, 'Negative allocation', -1)`,
        [USER_ID, PROFILE_ID]
      )
    ).toBe('savingsGoals_monthlyAllocation_non_negative')
  })

  it('savingsGoals_monthlyAllocation_non_negative ACCEPTS null (no manual amount)', async () => {
    // Same shape as the `targetAmount` null case above, and the same limit: a bare
    // `>= 0` would accept NULL too, so this does not prove the null arm is present.
    // `migration-replay.test.ts`'s predicate comparison is what proves that.
    expect(
      await outcomeOf(
        `INSERT INTO "savingsGoals" ("userId", "profileId", name, "monthlyAllocation")
         VALUES ($1, $2, 'Automatic allocation', NULL)`,
        [USER_ID, PROFILE_ID]
      )
    ).toBe(ACCEPTED)
  })

  it('balanceTracking_monthlyContribution_non_negative refuses a negative contribution', async () => {
    expect(
      await outcomeOf(
        `INSERT INTO "balanceTracking" ("userId", "profileId", type, name, "monthlyContribution")
         VALUES ($1, $2, 'investment', '401k', -1)`,
        [USER_ID, PROFILE_ID]
      )
    ).toBe('balanceTracking_monthlyContribution_non_negative')
  })

  it('⚠️ balanceTracking.currentBalance stays NEGATIVE-CAPABLE — debts are stored there', async () => {
    // ⚠️⚠️ THE FALSE-REJECTION CONTROL, and the reason story 66.5 took a decision
    // rather than adding a constraint to every numeric column. `savingsGoals`
    // gets a `currentBalance >= 0` check; `balanceTracking` deliberately does NOT,
    // because a debt row's balance is negative by design (`schema.ts` says "can be
    // negative for debt"). If someone ever mirrors the savings constraint onto
    // this table, every debt the user tracks stops saving — and this test is what
    // says so before they ship it.
    expect(
      await outcomeOf(
        `INSERT INTO "balanceTracking" ("userId", "profileId", type, name, "currentBalance")
         VALUES ($1, $2, 'debt', 'Mortgage', -250000)`,
        [USER_ID, PROFILE_ID]
      )
    ).toBe(ACCEPTED)
  })
})
