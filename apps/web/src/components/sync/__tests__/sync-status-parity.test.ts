// @vitest-environment node
//
// ⚠️ The environment override is REQUIRED and is the whole reason this guard can
// compare the two real constants. `vitest.config.ts` maps `src/**/components/**`
// to jsdom, and `@budget-planner/db` deliberately THROWS when `window` is defined
// ("server-only package, do not import in browser code"). Importing the server's
// gate from a jsdom test therefore fails at import time. Running this one file in
// node lets both constants load; nothing here touches the DOM.

/**
 * Client/server sync-gate parity (Story 34.1a, AC-8).
 *
 * `SyncProvider` decides whether `<ActiveSync>` mounts at all. Its
 * `PAID_SYNC_STATUSES` was missing `'lifetime'` while the comment directly above
 * it claimed the list matched the server "exactly" — so a lifetime buyer received
 * no sync at all, and silently: the gate short-circuits before any request is
 * made, so there was no 403, no failed push, and nothing in the console.
 *
 * ⚠️ THIS GUARD IMPORTS BOTH REAL CONSTANTS AND COMPARES THEM TO EACH OTHER.
 * Story 33.2's finding was that a guard deriving its expectation from the thing it
 * guards cannot fail; the mirror-image mistake is a guard that RESTATES the
 * expected values, which passes happily while both sides drift together. Comparing
 * the two independent declarations is what actually catches drift in either one.
 *
 * Importing the server module from a TEST is safe (it pulls `@budget-planner/db`,
 * which is fine under vitest) — it is only the CLIENT BUNDLE that must not, which
 * is why SyncProvider keeps its own literal rather than importing this constant.
 * `src/server/api/__tests__/sync-category-gates.test.ts` already imports it the
 * same way.
 */

import { describe, expect, it } from 'vitest'
import { PAID_SYNC_STATUSES as SERVER_STATUSES } from '../../../server/api/sync'
import { PAID_SYNC_STATUSES as CLIENT_STATUSES } from '../SyncProvider'

describe('PAID_SYNC_STATUSES — the client gate must mirror the server gate (AC-8)', () => {
  /**
   * MUTATION KILLED (M11): remove `'lifetime'` from SyncProvider.
   *
   * Order-insensitive: the two are membership gates (`.includes`), so a differing
   * order is not a defect and should not fail this test.
   */
  it('declares exactly the same set of statuses on both sides', () => {
    expect([...CLIENT_STATUSES].sort()).toEqual([...SERVER_STATUSES].sort())
  })

  /**
   * Asserted independently of the parity check above, which would stay green if
   * BOTH sides lost 'lifetime' together — precisely the drift a pure parity test
   * cannot see. This is the one place the value is deliberately restated.
   */
  it('includes lifetime on the client, the status that was missing', () => {
    expect(CLIENT_STATUSES).toContain('lifetime')
  })

  it('includes active and past_due, and nothing unpaid', () => {
    expect(CLIENT_STATUSES).toContain('active')
    expect(CLIENT_STATUSES).toContain('past_due')
    for (const unpaid of ['free', 'canceled']) {
      expect(CLIENT_STATUSES as readonly string[]).not.toContain(unpaid)
    }
  })

  /**
   * ⚠️ THIS LITERAL IS RESTATED, NOT IMPORTED, AND THAT IS A KNOWN WEAKNESS.
   * Code review 34.1a flagged that restating `['active','lifetime']` means this
   * test stays green if a new premium-granting status (a trial tier, say) is added
   * to `usePremiumAccess` but not to the sync gates — re-creating the original
   * defect's shape one status later. Verified there is nothing to import:
   * `usePremiumAccess` has no exported premium-status set, it inline-compares
   * (`usePremiumAccess.ts:79`: `subscriptionStatus === 'active' || === 'lifetime'`).
   * Exporting one is the real fix and belongs with a story that touches that hook.
   * Until then this pins today's known set rather than tomorrow's.
   */
  it('covers every status usePremiumAccess treats as premium (today)', () => {
    // A user shown premium surfaces must also be allowed to sync; the original
    // defect was exactly this divergence (premium unlocked, sync denied).
    for (const premium of ['active', 'lifetime']) {
      expect(CLIENT_STATUSES as readonly string[]).toContain(premium)
    }
  })
})
