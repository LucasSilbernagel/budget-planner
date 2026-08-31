/**
 * The stored flag name deliberately does not match its label (Story 47.1, D2, AC-12).
 *
 * ## The mismatch, and why it is intentional
 *
 * The checkbox on the Balance Tracking form reads "Not taken from the money left
 * over" and asks a question covering TWO situations: money that never reached the
 * user (deducted from their pay), and money they also typed onto the Expenses page.
 * The field behind it is still called `contributionRecordedAsExpense`, which names
 * only the second.
 *
 * That is a decision (D2), not an oversight. Both situations need the identical
 * treatment — skip the row from the savings distributable pool — so the flag's
 * BEHAVIOUR was already correct for both and only its label was wrong. Renaming the
 * field would be a five-gate sync change plus hand-written DDL (drizzle-kit 0.23
 * does not track CHECK constraints) for no user-visible gain.
 *
 * ## Why a guard rather than a comment alone
 *
 * A comment explaining a deliberate mismatch is exactly the kind of comment a later
 * tidy-up deletes, because from the outside it reads as a stale TODO. This test
 * makes the rationale load-bearing: delete the comment and a test goes red, which
 * is the only way the reasoning survives contact with a future refactor.
 *
 * ⚠️ The comment is pinned in `BalancePage.tsx`, NOT in `packages/core` or
 * `packages/db`. Three reasons, all verified: story 47.1 fences both packages;
 * `packages/db` runs in its own vitest project that this story's gates never
 * invoke; and a comment in `savingsAllocation.ts` naming `contributionDuplicates`
 * would turn `contributionDuplicates.test.ts`'s import-fence assertion red for a
 * reason that looks nothing like its name. The form is where the next developer
 * actually meets the mismatch.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BALANCE_PAGE = join(__dirname, '..', 'BalancePage.tsx')

describe('BalancePage — the D2 naming rationale is recorded at the control (Story 47.1, AC-12)', () => {
  it('carries the rationale comment beside the checkbox', () => {
    const source = readFileSync(BALANCE_PAGE, 'utf8')

    // Anchored on the DISTINGUISHING claim, not on the field name — the field name
    // appears throughout the file and would pass against a deleted comment.
    expect(source).toMatch(/mismatch\s+is\s+DELIBERATE/i)
    expect(source).toMatch(/five-gate\s+sync\s+change/i)
    expect(source).toMatch(/drizzle-kit\s+0\.23\s+does\s+not\s+track\s+CHECK/i)
  })

  it('keeps the rationale AT the control, not merely somewhere in the file', () => {
    // ⚠️ Code review: whole-file `toMatch`es let the comment be moved anywhere in
    // 1100+ lines while this guard stayed green — losing the stated property, which
    // is that the next developer meets the rationale where they meet the mismatch.
    const source = readFileSync(BALANCE_PAGE, 'utf8')
    const comment = source.indexOf('mismatch is DELIBERATE')
    const control = source.indexOf('data-testid="balance-contribution-recorded-as-expense"')
    expect(comment).toBeGreaterThan(-1)
    expect(control).toBeGreaterThan(-1)
    const linesApart = source
      .slice(Math.min(comment, control), Math.max(comment, control))
      .split('\n').length
    expect(linesApart).toBeLessThan(40)
  })

  it('still declares the field the comment is about', () => {
    // Acceptance partner: a wrong path, or a rename that made the comment moot,
    // must not leave the assertions above passing in isolation.
    const source = readFileSync(BALANCE_PAGE, 'utf8')
    expect(source).toContain('contributionRecordedAsExpense')
    expect(source).toContain('data-testid="balance-contribution-recorded-as-expense"')
  })
})
