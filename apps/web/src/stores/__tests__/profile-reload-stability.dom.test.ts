/**
 * The active profile id must survive a page reload (code review of story 54.4, HIGH).
 *
 * ⚠️ THE DEFECT THIS PINS. `DEFAULT_PROFILE.id` is `generateUUID()` evaluated at
 * MODULE LOAD, and a free user never writes the profile store — so zustand's
 * `rehydrate()` of an empty key left nothing in storage, and every page load
 * minted a new default id. Since 54.4 stamps every new row with the active
 * profile and scopes reads by it, a row added on one load was hidden on the next:
 * silent data loss for every free user.
 *
 * A "reload" is simulated with `vi.resetModules()` + fresh dynamic imports, which
 * re-evaluates `DEFAULT_PROFILE` exactly as a real page load does. Only store
 * state and the pure scoping predicate are read — no hooks — because a reset
 * module registry would hand React hooks a second copy of React.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROFILE_KEY = 'budget-planner-profiles-v1'
const INCOME_KEY = 'budget-planner-income-v1'

async function loadPage() {
  vi.resetModules()
  const { useProfileStore } = await import('../profileStore')
  const { useIncomeStore } = await import('../incomeStore')
  const { scopeToActiveProfile } = await import('../../lib/profile-scope')
  await useProfileStore.persist.rehydrate()
  await useIncomeStore.persist.rehydrate()
  return { useProfileStore, useIncomeStore, scopeToActiveProfile }
}

function clearKeys(): void {
  localStorage.removeItem(PROFILE_KEY)
  localStorage.removeItem(INCOME_KEY)
}

beforeEach(clearKeys)
afterEach(clearKeys)

describe('active profile id across a reload (free tier)', () => {
  it('keeps the same default profile id on the second load of a fresh browser', async () => {
    const first = await loadPage()
    const firstId = first.useProfileStore.getState().activeProfileId

    const second = await loadPage()

    expect(firstId).not.toBeNull()
    expect(second.useProfileStore.getState().activeProfileId).toBe(firstId)
  })

  it('a row added on one load is still visible after a reload', async () => {
    const first = await loadPage()
    first.useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Added before reload', amount: 1234, frequency: 'monthly' })

    const second = await loadPage()
    const { incomeSources } = second.useIncomeStore.getState()
    const visible = second.scopeToActiveProfile(
      incomeSources,
      second.useProfileStore.getState().activeProfileId
    )

    // Positive control: the row really was persisted and reloaded.
    expect(incomeSources.map((row) => row.name)).toEqual(['Added before reload'])
    expect(visible.map((row) => row.name)).toEqual(['Added before reload'])
  })

  it('does not overwrite a saved profile selection on reload', async () => {
    const first = await loadPage()
    first.useProfileStore.getState().addProfile({
      id: 'cccccccc-0000-4000-8000-00000000000c',
      userId: 'u-1',
      name: 'Second',
      isDefault: false,
      currency: 'NONE',
    })
    first.useProfileStore.getState().switchProfile('cccccccc-0000-4000-8000-00000000000c')

    const second = await loadPage()

    expect(second.useProfileStore.getState().activeProfileId).toBe(
      'cccccccc-0000-4000-8000-00000000000c'
    )
    expect(second.useProfileStore.getState().profiles).toHaveLength(2)
  })
})
