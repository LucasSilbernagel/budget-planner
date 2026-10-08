/** A wrong "permanent" drops an edit a replay would have saved, so exclusions matter as much as inclusions. */

import { describe, expect, it } from 'vitest'
import { constraintOf, permanentRejectionReason, sqlStateOf } from '../sync-rejection'

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
    // Excluded: the server gate already refuses their op-data cause; what remains is schema skew.
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
    // The driver does not wrap errors, so a code only on `cause` is not treated as proof.
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
