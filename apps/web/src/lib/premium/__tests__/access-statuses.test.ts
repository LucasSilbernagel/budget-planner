/**
 * Story 78.3 — the ONE definition of which subscription statuses grant what.
 *
 * The compile-time half lives in `access-statuses.ts`: `STATUS_ACCESS`
 * `satisfies Record<SubscriptionStatus, …>`, so a new enum value is a `tsc`
 * error until it is classified for BOTH questions. This file is the runtime
 * half, asserted against the enum the database actually has.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { subscriptionStatusEnum } from '@budget-planner/db/src/schema'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  PAID_ACCESS_STATUSES,
  PREMIUM_FEATURE_STATUSES,
  type PaidAccessStatus,
  type PremiumFeatureStatus,
  STATUS_ACCESS,
  hasPaidAccess,
  hasPremiumFeatures,
} from '../access-statuses'

const ENUM = [...subscriptionStatusEnum.enumValues].sort()

describe('STATUS_ACCESS (Story 78.3)', () => {
  it('classifies every enum value, and nothing else', () => {
    expect(Object.keys(STATUS_ACCESS).sort()).toEqual(ENUM)
  })

  it('paid access is exactly active, past_due and lifetime', () => {
    expect([...PAID_ACCESS_STATUSES].sort()).toEqual(['active', 'lifetime', 'past_due'])
  })

  it('premium features are exactly active and lifetime — past_due is paid but NOT premium (Story 4-18)', () => {
    expect([...PREMIUM_FEATURE_STATUSES].sort()).toEqual(['active', 'lifetime'])
    expect(hasPaidAccess('past_due')).toBe(true)
    expect(hasPremiumFeatures('past_due')).toBe(false)
  })

  it('every premium-feature status also has paid access (premium ⊆ paid)', () => {
    // The 30.4a / 34.1a defect: a status unlocked premium surfaces while sync
    // (a paid-access gate) refused it. With one classification this is the
    // invariant that must hold for any status added later.
    for (const status of PREMIUM_FEATURE_STATUSES) {
      expect(PAID_ACCESS_STATUSES).toContain(status)
    }
  })

  it('free and canceled grant neither', () => {
    for (const status of ['free', 'canceled']) {
      expect(hasPaidAccess(status)).toBe(false)
      expect(hasPremiumFeatures(status)).toBe(false)
    }
  })

  it.each([
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    '',
    'Active',
    'lifetime ',
    null,
    undefined,
    42,
    {},
  ])('rejects a non-status value (%s) for both questions', (value) => {
    // ⚠️ A lookup like `STATUS_ACCESS[status]` on an arbitrary string would
    // reach Object.prototype (story 75.4's prototype-key crash). The guards
    // must answer false, never throw.
    expect(hasPaidAccess(value)).toBe(false)
    expect(hasPremiumFeatures(value)).toBe(false)
  })

  it('the module has no runtime imports (client-safe: it must never pull @budget-planner/db or drizzle into a client chunk)', () => {
    const source = readFileSync(resolve(__dirname, '../access-statuses.ts'), 'utf8')
    // Count EVERY module specifier, however it is spelled: `import … from`,
    // `export * as x from`, `export { … } from`, dynamic `import(…)`, `require(…)`.
    const specifiers = [
      ...source.matchAll(/\bfrom\s*['"]|\bimport\s*\(|\brequire\s*\(|^\s*import\s*['"]/gm),
    ]
    // Pinned: exactly the one type-only import of `SubscriptionStatus`.
    expect(specifiers).toHaveLength(1)
    expect(source).toMatch(
      /^import type \{ SubscriptionStatus \} from '@budget-planner\/db\/src\/schema'$/m
    )
  })

  it('the shared arrays are frozen (one object gates sync, checkout AND the purge)', () => {
    expect(Object.isFrozen(PAID_ACCESS_STATUSES)).toBe(true)
    expect(Object.isFrozen(PREMIUM_FEATURE_STATUSES)).toBe(true)
  })

  it('the derived types are the literal unions the table implies (checked by web type-check)', () => {
    // Compile-time: a table edit that changes either set fails `tsc -p
    // tsconfig.vitest.json` here (measured: flipping past_due.premiumFeatures
    // → TS2344). Dropping `as const` alone does NOT widen the booleans —
    // `satisfies` keeps the literals — so that is not what this guards.
    expectTypeOf<PaidAccessStatus>().toEqualTypeOf<'active' | 'past_due' | 'lifetime'>()
    expectTypeOf<PremiumFeatureStatus>().toEqualTypeOf<'active' | 'lifetime'>()
  })
})
