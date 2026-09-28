/**
 * Story 73.2, AC-5 — the entitled/lapsed classification covers every
 * `subscriptionStatus` exactly once, and the purge's set is written positively.
 *
 * The COMPILE-time half lives in `status-classes.ts` itself: `STATUS_CLASS`
 * `satisfies Record<SubscriptionStatus, StatusClass>`, so a missing enum value
 * is a `tsc` error (control recorded in the story's Debug Log). This file is
 * the RUNTIME half, asserted against the enum the database actually has.
 */

import { subscriptionStatusEnum } from '@budget-planner/db/src/schema'
import { describe, expect, it } from 'vitest'
import {
  ENTITLED_STATUSES,
  LAPSED_STATUSES,
  STATUS_CLASS,
  isEntitledStatus,
} from '../status-classes'

const ENUM = [...subscriptionStatusEnum.enumValues].sort()

describe('retention status classification (Story 73.2)', () => {
  it('classifies every enum value, and nothing else', () => {
    expect(Object.keys(STATUS_CLASS).sort()).toEqual(ENUM)
  })

  it('splits the enum into two DISJOINT sets whose union is the whole enum', () => {
    const overlap = ENTITLED_STATUSES.filter((s) => LAPSED_STATUSES.includes(s))
    expect(overlap).toEqual([])
    expect([...ENTITLED_STATUSES, ...LAPSED_STATUSES].sort()).toEqual(ENUM)
  })

  it('never classifies a paying status as lapsed — lifetime, active and past_due are entitled', () => {
    // The survival guarantee in its simplest form: the purge selects
    // LAPSED_STATUSES, so none of these may ever be in it.
    for (const status of ['lifetime', 'active', 'past_due'] as const) {
      expect(LAPSED_STATUSES).not.toContain(status)
      expect(isEntitledStatus(status)).toBe(true)
    }
  })

  it('treats canceled and free (paused) as lapsed', () => {
    expect([...LAPSED_STATUSES].sort()).toEqual(['canceled', 'free'])
  })

  it('matches the five pre-existing hand-rolled copies of the entitled set', () => {
    // Those copies are not migrated onto this module (D3). This pins the value
    // they all share, so a drift here is visible.
    expect([...ENTITLED_STATUSES].sort()).toEqual(['active', 'lifetime', 'past_due'])
  })
})
