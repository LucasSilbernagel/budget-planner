import { describe, expect, it } from 'vitest'
import { type DbShape, assessMigrateSafety } from './migrate-preflight'

// Story 5.4 — AC-4: `db:migrate` runs as a deploy step, and must refuse any
// target it cannot prove is safe (the deferred-work:643 push-built hazard).

/** A journal-tracked production database: the normal, safe case. */
const journaled: DbShape = { hasJournalTable: true, journalRowCount: 17, userTableCount: 12 }
/** A freshly provisioned, completely empty database (4-17's clean slate). */
const empty: DbShape = { hasJournalTable: false, journalRowCount: 0, userTableCount: 0 }
/** The hazard: schema built by `drizzle-kit push`, so no journal exists. */
const pushBuilt: DbShape = { hasJournalTable: false, journalRowCount: 0, userTableCount: 12 }

describe('assessMigrateSafety — safe targets', () => {
  it('allows a journal-tracked database', () => {
    const v = assessMigrateSafety(journaled)
    expect(v.safe).toBe(true)
    expect(v.provenance).toBe('journaled')
    expect(v.reason).toContain('17')
  })

  it('allows a genuine clean slate (no schema at all)', () => {
    const v = assessMigrateSafety(empty)
    expect(v.safe).toBe(true)
    expect(v.provenance).toBe('empty')
  })

  it('allows a clean slate that already has an empty journal table', () => {
    // drizzle created the journal but applied nothing yet — still a clean slate.
    const v = assessMigrateSafety({
      hasJournalTable: true,
      journalRowCount: 0,
      userTableCount: 0,
    })
    expect(v.safe).toBe(true)
    expect(v.provenance).toBe('empty')
  })

  it('treats a single journal row as tracked (boundary: 1, not >1)', () => {
    const v = assessMigrateSafety({ ...journaled, journalRowCount: 1 })
    expect(v.safe).toBe(true)
    expect(v.provenance).toBe('journaled')
  })
})

describe('assessMigrateSafety — the push-built hazard (deferred-work:643)', () => {
  it('REFUSES a schema-bearing database with no journal', () => {
    const v = assessMigrateSafety(pushBuilt)
    expect(v.safe).toBe(false)
    expect(v.provenance).toBe('push-built')
  })

  it('names the concrete corruption and points at Story 4-17', () => {
    // The message is the whole operator-facing value of this guard: a bare
    // "unsafe" would send someone hunting. Anchor on the distinguishing words.
    const { reason } = assessMigrateSafety(pushBuilt)
    expect(reason).toContain('userProfiles')
    expect(reason).toContain('4-17')
  })

  it('refuses even a single leftover table', () => {
    const v = assessMigrateSafety({ ...pushBuilt, userTableCount: 1 })
    expect(v.safe).toBe(false)
    expect(v.provenance).toBe('push-built')
  })
})

describe('assessMigrateSafety — fails closed on shapes it cannot explain', () => {
  // Regression: code review 2026-09-03. The `journaled` fast path used to ignore
  // userTableCount entirely, so this shape returned safe/journaled. 13 tests and
  // 4 mutation arms all missed it because every fixture pinned userTableCount: 12
  // — the assertions bit, but the fixture space had a hole.
  it('refuses a journal with history over a database that has NO tables', () => {
    const v = assessMigrateSafety({
      hasJournalTable: true,
      journalRowCount: 5,
      userTableCount: 0,
    })
    expect(v.safe).toBe(false)
    expect(v.provenance).toBe('inconsistent')
    expect(v.reason).toContain('skip')
  })

  it('treats both directions of journal/schema disagreement identically', () => {
    // The two mirror images must BOTH fail closed; the original defect was the
    // asymmetry between them, so assert them together.
    const schemaGone = assessMigrateSafety({
      hasJournalTable: true,
      journalRowCount: 5,
      userTableCount: 0,
    })
    const journalGone = assessMigrateSafety({
      hasJournalTable: true,
      journalRowCount: 0,
      userTableCount: 12,
    })
    expect([schemaGone.safe, journalGone.safe]).toEqual([false, false])
    expect([schemaGone.provenance, journalGone.provenance]).toEqual([
      'inconsistent',
      'inconsistent',
    ])
  })

  it('refuses an empty journal over an existing schema', () => {
    const v = assessMigrateSafety({
      hasJournalTable: true,
      journalRowCount: 0,
      userTableCount: 12,
    })
    expect(v.safe).toBe(false)
    expect(v.provenance).toBe('inconsistent')
  })

  it.each([
    [
      'NaN journal count',
      { hasJournalTable: true, journalRowCount: Number.NaN, userTableCount: 3 },
    ],
    ['fractional table count', { hasJournalTable: true, journalRowCount: 2, userTableCount: 1.5 }],
    ['negative table count', { hasJournalTable: true, journalRowCount: 2, userTableCount: -1 }],
    [
      'Infinity journal count',
      { hasJournalTable: true, journalRowCount: Number.POSITIVE_INFINITY, userTableCount: 3 },
    ],
  ])('refuses an unreadable probe result: %s', (_label, shape) => {
    const v = assessMigrateSafety(shape as DbShape)
    expect(v.safe).toBe(false)
    expect(v.provenance).toBe('unreadable')
  })

  it('does not let a bad count sneak through the journaled fast path', () => {
    // Guards ordering: the sanity check must run BEFORE the `journalRowCount > 0`
    // branch, or Infinity would read as a healthy tracked database.
    expect(
      assessMigrateSafety({
        hasJournalTable: true,
        journalRowCount: Number.POSITIVE_INFINITY,
        userTableCount: 12,
      }).provenance
    ).toBe('unreadable')
  })
})
