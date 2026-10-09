// PGlite is real PostgreSQL, so these prove enforcement. Pin the constraint name: an INSERT can
// fail for unrelated reasons (NOT NULL, FK, enum).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type JournalEntry = {
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

/** Minimal valid user + profile; columns are exactly the NOT NULL ones with no DB default. */
const SEED_SQL = `
INSERT INTO "users" (id, email, "paddleId")
VALUES ('${USER_ID}', 'checks@test.com', 'pad_checks');

INSERT INTO "userProfiles" (id, "userId", name)
VALUES ('${PROFILE_ID}', '${USER_ID}', 'Default');
`

let db: PGlite

beforeAll(async () => {
	db = await PGlite.create()
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

const ACCEPTED = 'ACCEPTED' as const

// PGlite exposes `error.constraint`, not `constraint_name`. The ACCEPTED sentinel keeps
// "accepted" and "refused but unnamed" distinct.
async function outcomeOf(sql: string, params: unknown[] = []): Promise<string> {
	try {
		await db.query(sql, params)
		return ACCEPTED
	} catch (error) {
		const e = error as { constraint?: string; code?: string; message?: string }
		// 23514 is `check_violation`.
		if (e.code !== '23514') {
			throw new Error(`Expected a CHECK violation (23514) but got ${e.code}: ${e.message}`)
		}
		if (!e.constraint) {
			throw new Error(`CHECK violation carried no constraint name: ${e.message}`)
		}
		return e.constraint
	}
}

describe('CHECK constraints are enforced by the database', () => {
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

	it('savingsGoals_targetAmount_positive ACCEPTS null (a goal-less savings account)', async () => {
		// A CHECK passes when its predicate is NULL, so this can't prove the `IS NULL OR` arm exists;
		// only the predicate text comparison in the replay test can.
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

	/** Zero is the only value that tells `>= 0` from `> 0`. */
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
		// The form writes 0 for asset rows.
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
		// balanceTracking deliberately has no `currentBalance >= 0` check: debt balances are negative.
		expect(
			await outcomeOf(
				`INSERT INTO "balanceTracking" ("userId", "profileId", type, name, "currentBalance")
         VALUES ($1, $2, 'debt', 'Mortgage', -250000)`,
				[USER_ID, PROFILE_ID]
			)
		).toBe(ACCEPTED)
	})
})
