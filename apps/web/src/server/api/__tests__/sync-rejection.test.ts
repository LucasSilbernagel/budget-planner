/**
 * The permanent-refusal allow-list (story 75.1, AC-1/AC-2).
 *
 * Every named code must classify as permanent; every code the story deliberately
 * EXCLUDES — the ordering-dependent integrity errors and the transient ones — must
 * classify as NOT permanent, because a wrong "permanent" drops a user's edit that
 * a replay would have saved.
 */

import { describe, expect, it } from 'vitest'
import { constraintOf, permanentRejectionReason, sqlStateOf } from '../sync-rejection'

/** A driver error as PGlite / node-postgres throw it: the SQLSTATE on `code`. */
function pgError(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`pg error ${code}`), { code, ...extra })
}

describe('permanentRejectionReason', () => {
  it.each([
    ['23514', 'constraint'],
    ['22003', 'invalid'],
  ])('classifies %s as permanent (%s)', (code, reason) => {
    expect(permanentRejectionReason(pgError(code))).toBe(reason)
  })

  it.each([
    // Ordering-dependent: can clear once another op lands.
    ['23503', 'foreign key — the referenced category may not have synced yet'],
    ['23505', 'unique — a promotion or rename swap can arrive half-applied'],
    // Narrowed OUT by the code review (decision D2): the server gate already
    // refuses their op-data cause, so what remains is server/schema skew.
    ['23502', 'not-null — required fields are zod-required'],
    ['22P02', 'invalid text — uuids and enums are zod-validated'],
    ['22001', 'truncation — zod .max() matches the varchar'],
    ['22007', 'datetime format'],
    ['22008', 'datetime overflow'],
    // Transient.
    ['40001', 'serialization failure'],
    ['40P01', 'deadlock'],
    ['57014', 'statement timeout'],
    ['08006', 'connection failure'],
    // Unknown codes default to NOT permanent — an allow-list, not a deny-list.
    ['XX000', 'internal error'],
  ])('leaves %s NOT permanent (%s)', (code) => {
    expect(permanentRejectionReason(pgError(code))).toBeUndefined()
  })

  it.each([
    ['an Error with no code', new Error('connection terminated unexpectedly')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['a numeric code', Object.assign(new Error('x'), { code: 23514 })],
    // Measured in Task 2: the driver does NOT wrap, so a code only on `cause`
    // is not something this path ever sees — and is not treated as proof.
    ['a code only on cause', Object.assign(new Error('x'), { cause: pgError('23514') })],
  ])('leaves %s NOT permanent', (_label, error) => {
    expect(permanentRejectionReason(error)).toBeUndefined()
  })
})

describe('sqlStateOf / constraintOf', () => {
  it('reads the code and the constraint from the fields the driver populates', () => {
    const error = pgError('23514', { constraint: 'savingsGoals_currentBalance_non_negative' })
    expect(sqlStateOf(error)).toBe('23514')
    expect(constraintOf(error)).toBe('savingsGoals_currentBalance_non_negative')
  })

  it('does NOT read `constraint_name` — the wire-protocol spelling the driver never sets', () => {
    expect(constraintOf(pgError('23514', { constraint_name: 'x' }))).toBeUndefined()
  })
})
