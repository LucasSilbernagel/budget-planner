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
    for (const status of ['lifetime', 'active', 'past_due'] as const) {
      expect(LAPSED_STATUSES).not.toContain(status)
      expect(isEntitledStatus(status)).toBe(true)
    }
  })

  it('treats canceled and free (paused) as lapsed', () => {
    expect([...LAPSED_STATUSES].sort()).toEqual(['canceled', 'free'])
  })

  it('pins the entitled set every paid-access gate shares', () => {
    // Pinned independently so a change to the shared definition shows up as a retention change.
    expect([...ENTITLED_STATUSES].sort()).toEqual(['active', 'lifetime', 'past_due'])
  })
})
