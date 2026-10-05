import type { IncomeBasis, RetirementModel } from '@budget-planner/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  RETIREMENT_PLAN_DEFAULTS,
  type RetirementPlan,
  coerceRetirementPlan,
} from '../lib/retirement-plan'

// Story 99.2: the plan's shape, defaults and coercion live in the store-free
// `lib/retirement-plan.ts` (the sync bridge needs them and must import no store).
// Re-exported so every existing import from this module keeps working.
export { RETIREMENT_PLAN_DEFAULTS, coerceRetirementPlan }
export type { RetirementPlan }

/**
 * The persisted retirement plan (Story 44.1, FR71).
 *
 * ## What this stores
 *
 * The eleven values the user authors on `/retirement` (the `RetirementPlan` shape,
 * now in `lib/retirement-plan.ts`; story 99.2 corrected "nine", stale since 65.2). Before this store they were
 * plain `useState` inside `RetirementAccumulationPlanner`, so the whole plan was
 * lost on reload AND on every route change — `/retirement` unmounts on each nav,
 * which is the more common loss of the two.
 *
 * Everything here is the RAW INPUT STRING, exactly as typed, not a parsed number.
 * The component parses on demand and needs to tell "not filled in" from "entered
 * zero" — a distinction that only survives if the empty string survives.
 *
 * ## What this deliberately does NOT store
 *
 * "Current Amount Saved" (FR48) and "Monthly Savings" (FR49, as amended by FR74 /
 * story 47.2) are `useMemo` derivations over the balance store. Persisting them would
 * freeze a stale figure into the one page whose whole purpose is to track the
 * others: a plan restored six months later would show the savings you had when
 * you saved it. They stay derived.
 *
 * ⚠️ It is no longer device-only (story 99.2). Premium accounts have a server copy:
 * one `retirementPlans` row per account, pulled into this store by
 * `lib/sync/applyServerChanges.ts` (plain `setState`, which also records
 * {@link RetirementPlannerStoreState.serverUpdatedAt}). The client PUSH is story
 * 99.3's: as of 99.2 no setter here queues a sync op, and a test pins that
 * (`retirement-plan-dormant.dom.test.ts`). Free and signed-out use is unchanged:
 * no network, the same key, the same persisted bytes.
 *
 * ## ⚠️ `merge` is the load-bearing coercion, NOT `migrate`
 *
 * `migrate` runs only when the persisted `version` differs from
 * {@link RETIREMENT_PLANNER_VERSION}. A corrupt blob written at the CURRENT
 * version — a truncated write, hand-edited storage, another build — never
 * reaches it and would land straight in state. `merge` runs on every rehydrate,
 * so it is what actually guarantees the fallback to defaults.
 *
 * This matters more here than in most stores because the values feed a solver
 * that throws on anything non-finite, and `parseAge` calls `.trim()` on its
 * argument: a persisted `currentAgeInput: 42` (a NUMBER) is a `TypeError` before
 * any of the component's own guards run. Coercion by `typeof`, on every
 * rehydrate, is what makes AC-5's "never handed a value it cannot read" true.
 *
 * `migrate` is kept because it is the seam a future shape change needs — but do
 * not mistake it for the guard. Story 42.1 measured exactly this: deleting
 * `migrate` from the sibling store left its whole suite green.
 */

/** localStorage key for the persisted retirement plan. */
export const RETIREMENT_PLANNER_STORAGE_KEY = 'budget-planner-retirement-planner-v1'

/**
 * Persisted payload version. Bumping this routes the old blob through `migrate`.
 *
 * ⚠️ The `-v1` in the KEY above is part of the key, not this number. Renaming it
 * orphans every stored plan instead of migrating it (`expenseStore.ts` records
 * the same warning).
 */
export const RETIREMENT_PLANNER_VERSION = 1

/**
 * The `React.Dispatch<React.SetStateAction<string>>` shape.
 *
 * Kept deliberately compatible: `RetirementAccumulationPlanner`'s `reEcho` blur
 * handler and `sanitizeMoneyChange` caret correction both call their setter with
 * an UPDATER, and `currencyField` is typed against the React dispatch signature.
 * A value-only action would force those three to be rewritten for no gain.
 */
type StringSetter = (value: string | ((previous: string) => string)) => void

interface RetirementPlannerStoreState {
  /** The user's plan. One object so the component reads a single stable value. */
  plan: RetirementPlan
  /**
   * Whose plan this is (story 90.1, D1): the signed-in account's id, or `''` for
   * a plan nobody has claimed yet (authored signed out, or saved before this
   * field existed). Written ONLY by {@link claimRetirementPlanFor}, once per
   * document load, for the session that load resolved; never by an edit, so the
   * setters below stay unchanged.
   */
  ownerUserId: string
  /**
   * The server `updatedAt` (ISO) of the plan this device last PULLED for
   * {@link ownerUserId}, or `null` when this plan has never come from the server
   * (story 99.2). Written by the pull applier, reset to `null` by
   * {@link claimRetirementPlanFor} on every owner change. Story 99.3 reads it as
   * the push's `baseVersion` and, after the initial pull, as "the server has no
   * plan yet" (`null`).
   *
   * ⚠️ Persisted ONLY when set: a device that never synced writes exactly the
   * bytes it wrote before 99.2. No version bump; `merge` coerces it.
   */
  serverUpdatedAt: string | null
  setCurrentAgeInput: StringSetter
  setLifeExpectancyInput: StringSetter
  setDesiredIncomeInput: StringSetter
  /**
   * Record that the user has authored the desired income themselves, in
   * `locale` — the two facts are written together because a value without the
   * locale it is written in cannot be safely reparsed later.
   */
  markDesiredIncomeAuthored: (locale: string) => void
  /**
   * Rewrite the desired income and the locale it is formatted in, atomically.
   *
   * Used by the seed effect and by the locale-migration effect. Both halves must
   * move together or the string and its stated locale disagree, which is the
   * bug this field exists to prevent.
   */
  setDesiredIncomeForLocale: (value: string, locale: string) => void
  /**
   * Record (or clear, with `null`) the adopted monthly figure.
   *
   * Cleared on the first accepted keystroke: from then on the number is the
   * user's and re-expressing it would overwrite their edit.
   */
  setAdoptedMonthlyCents: (cents: number | null) => void
  setIncomeBasis: (basis: IncomeBasis) => void
  setAnnualReturnInput: StringSetter
  /**
   * Write the post-retirement rate AND set its touched flag, together.
   *
   * One writer for both halves so they cannot be persisted out of step (AC-3).
   */
  setPostRetirementReturn: StringSetter
  setModel: (model: RetirementModel) => void
  /** Return the whole plan to {@link RETIREMENT_PLAN_DEFAULTS}. */
  resetPlan: () => void
}

/** Apply a `SetStateAction`-shaped argument to one string field. */
function applyString(previous: string, value: string | ((previous: string) => string)): string {
  return typeof value === 'function' ? value(previous) : value
}

export const useRetirementPlannerStore = create<RetirementPlannerStoreState>()(
  persist(
    (set) => ({
      // Deterministic default, identical on the server and on the first client
      // paint. The persisted plan is applied after client rehydration (see
      // `lib/store-hydration`).
      plan: { ...RETIREMENT_PLAN_DEFAULTS },
      ownerUserId: '',
      serverUpdatedAt: null,

      setCurrentAgeInput: (value) => {
        set((current) => ({
          plan: {
            ...current.plan,
            currentAgeInput: applyString(current.plan.currentAgeInput, value),
          },
        }))
      },

      setLifeExpectancyInput: (value) => {
        set((current) => ({
          plan: {
            ...current.plan,
            lifeExpectancyInput: applyString(current.plan.lifeExpectancyInput, value),
          },
        }))
      },

      setDesiredIncomeInput: (value) => {
        set((current) => ({
          plan: {
            ...current.plan,
            desiredIncomeInput: applyString(current.plan.desiredIncomeInput, value),
          },
        }))
      },

      markDesiredIncomeAuthored: (locale) => {
        set((current) =>
          current.plan.desiredIncomeTouched && current.plan.desiredIncomeLocale === locale
            ? current
            : { plan: { ...current.plan, desiredIncomeTouched: true, desiredIncomeLocale: locale } }
        )
      },

      setDesiredIncomeForLocale: (value, locale) => {
        set((current) => ({
          plan: { ...current.plan, desiredIncomeInput: value, desiredIncomeLocale: locale },
        }))
      },

      setAdoptedMonthlyCents: (cents) => {
        set((current) =>
          current.plan.adoptedMonthlyCents === cents
            ? current
            : { plan: { ...current.plan, adoptedMonthlyCents: cents } }
        )
      },

      setIncomeBasis: (basis) => {
        set((current) => ({ plan: { ...current.plan, incomeBasis: basis } }))
      },

      setAnnualReturnInput: (value) => {
        set((current) => ({
          plan: {
            ...current.plan,
            annualReturnInput: applyString(current.plan.annualReturnInput, value),
          },
        }))
      },

      setPostRetirementReturn: (value) => {
        set((current) => ({
          plan: {
            ...current.plan,
            postRetirementReturnInput: applyString(current.plan.postRetirementReturnInput, value),
            // Set as the value is written, never separately. Clearing the field
            // is still an edit, so this stays `true` afterwards.
            postRetirementTouched: true,
          },
        }))
      },

      setModel: (model) => {
        set((current) => ({ plan: { ...current.plan, model } }))
      },

      resetPlan: () => {
        set({ plan: { ...RETIREMENT_PLAN_DEFAULTS } })
      },
    }),
    {
      name: RETIREMENT_PLANNER_STORAGE_KEY,
      // SSR-safe: defer the localStorage read to client-side rehydration (see
      // lib/store-hydration).
      skipHydration: true,
      partialize: (state) => ({
        plan: state.plan,
        ownerUserId: state.ownerUserId,
        // Only when set (story 99.2): a never-synced device persists the same bytes.
        ...(state.serverUpdatedAt !== null ? { serverUpdatedAt: state.serverUpdatedAt } : {}),
      }),
      version: RETIREMENT_PLANNER_VERSION,
      // The seam for a future shape change. See the module docblock: this is NOT
      // the corrupt-payload guard, because it does not run at the current version.
      migrate: (persisted) => {
        const serverUpdatedAt = coerceServerUpdatedAt(
          (persisted as { serverUpdatedAt?: unknown } | undefined)?.serverUpdatedAt
        )
        return {
          plan: coerceRetirementPlan((persisted as { plan?: unknown } | undefined)?.plan),
          ownerUserId: coerceOwner(
            (persisted as { ownerUserId?: unknown } | undefined)?.ownerUserId
          ),
          // The persisted shape (`partialize`) omits it when unset.
          ...(serverUpdatedAt !== null ? { serverUpdatedAt } : {}),
        }
      },
      // Runs on EVERY rehydrate. This is the guard: a corrupt, absent or foreign
      // payload opens the planner on defaults rather than throwing, and no field
      // reaches the parsers as anything but a string or a known literal.
      // `ownerUserId` is coerced the same way (story 90.1): a plan saved before the
      // field existed, or a non-string, is nobody's yet (`''`). No version bump.
      merge: (persisted, current) => ({
        ...current,
        plan: coerceRetirementPlan((persisted as { plan?: unknown } | undefined)?.plan),
        ownerUserId: coerceOwner((persisted as { ownerUserId?: unknown } | undefined)?.ownerUserId),
        serverUpdatedAt: coerceServerUpdatedAt(
          (persisted as { serverUpdatedAt?: unknown } | undefined)?.serverUpdatedAt
        ),
      }),
    }
  )
)

/**
 * A persisted server version that is not a parseable date string is "never
 * pulled" (story 99.2): it only ever becomes a `baseVersion`, and a bad one there
 * would make core's causal LWW compare against garbage.
 */
function coerceServerUpdatedAt(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

/** A persisted owner that is not a string is nobody's (story 90.1). */
function coerceOwner(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Where another account's plan is parked while someone else uses the browser
 * (story 90.1, D1): `<RETIREMENT_PLANNER_STORAGE_KEY>:<ownerUserId>`. "Clear
 * local data" removes every key with this prefix (D4).
 */
export const RETIREMENT_PLANNER_PARKED_KEY_PREFIX = `${RETIREMENT_PLANNER_STORAGE_KEY}:`

function readParkedPlan(userId: string): RetirementPlan | null {
  try {
    const raw = localStorage.getItem(`${RETIREMENT_PLANNER_PARKED_KEY_PREFIX}${userId}`)
    return raw === null ? null : coerceRetirementPlan(JSON.parse(raw))
  } catch {
    return null
  }
}

function removeParkedPlan(userId: string): void {
  try {
    localStorage.removeItem(`${RETIREMENT_PLANNER_PARKED_KEY_PREFIX}${userId}`)
  } catch {
    // Blocked storage: nothing was parked either.
  }
}

/**
 * Give the plan on screen to the session this document load resolved (story
 * 90.1, D1). `sessionUserId` is `''` for a signed-out session.
 *
 * - Already the session's: nothing.
 * - Nobody's yet (`''`): a signed-in session adopts it, like any placeholder row
 *   (5-15 AC-2: free -> signed in loses nothing), UNLESS the session has a
 *   parked plan of its own: that plan comes back and the unclaimed one is
 *   discarded (90.1 review R-D2 (a)).
 * - Another account's: it is PARKED under that account's key, not deleted, and the
 *   session gets its own parked plan back, or the defaults. The plan is synced
 *   for premium accounts (99.2/99.3); parking still covers free signed-in
 *   accounts and the window before the first pull, where resetting it would lose
 *   it on every sign-out.
 *
 * Every owner change resets `serverUpdatedAt` to `null` (story 99.2): the server
 * version it recorded was the PREVIOUS owner's, and the plan now on screen did not
 * come from this account's server copy.
 *
 * ⚠️ Must run AFTER rehydrate: it writes the persisted store, and a write before
 * rehydrate replaces the saved plan with the defaults (`StoreHydration` calls it).
 * Plain `setState`, never an action: the rule `dropAnotherAccountsLocalData`
 * follows, and the one that keeps this claim from ever queueing a sync op.
 */
export function claimRetirementPlanFor(sessionUserId: string): void {
  const { ownerUserId, plan } = useRetirementPlannerStore.getState()
  if (ownerUserId === sessionUserId) {
    return
  }
  if (ownerUserId === '') {
    // A signed-in session's own parked plan WINS over an unclaimed one (90.1
    // review R-D2 (a), Lucas 2026-10-03): otherwise a plan edited while signed
    // out would hide the returning owner's plan and strand it parked for good.
    // The signed-out edit is discarded, as an anonymous visitor's work is on any
    // sign-in. A signed-out session (`''`) has no parked plan.
    const parked = sessionUserId === '' ? null : readParkedPlan(sessionUserId)
    if (parked !== null) {
      removeParkedPlan(sessionUserId)
    }
    useRetirementPlannerStore.setState({
      ownerUserId: sessionUserId,
      plan: parked ?? plan,
      serverUpdatedAt: null,
    })
    return
  }
  // Park first: if storage refuses, keep the plan on screen rather than lose it.
  // ⚠️ That is a deliberate fail-OPEN for this store only: a refusing storage
  // also cannot hold the plan the next person would see after a reload.
  try {
    localStorage.setItem(
      `${RETIREMENT_PLANNER_PARKED_KEY_PREFIX}${ownerUserId}`,
      JSON.stringify(plan)
    )
  } catch (error) {
    console.error('[retirementPlanner] could not park the previous owner’s plan:', error)
    return
  }
  const own = sessionUserId === '' ? null : readParkedPlan(sessionUserId)
  if (own !== null) {
    removeParkedPlan(sessionUserId)
  }
  useRetirementPlannerStore.setState({
    ownerUserId: sessionUserId,
    plan: own ?? { ...RETIREMENT_PLAN_DEFAULTS },
    serverUpdatedAt: null,
  })
}

/**
 * The whole plan.
 *
 * ⚠️ Derives from the state argument and calls no state method — the rule
 * `lib/store-hydration.tsx` records (BUG-F) and
 * `stores/__tests__/no-method-selectors.guard.test.ts` sweeps for. A selector
 * that called a method would read LIVE state during hydration while the server
 * rendered the default, and React would discard the tree.
 */
export const useRetirementPlan = () => useRetirementPlannerStore((state) => state.plan)

export const useSetCurrentAgeInput = () =>
  useRetirementPlannerStore((state) => state.setCurrentAgeInput)

export const useSetLifeExpectancyInput = () =>
  useRetirementPlannerStore((state) => state.setLifeExpectancyInput)

export const useSetDesiredIncomeInput = () =>
  useRetirementPlannerStore((state) => state.setDesiredIncomeInput)

export const useMarkDesiredIncomeAuthored = () =>
  useRetirementPlannerStore((state) => state.markDesiredIncomeAuthored)

export const useSetDesiredIncomeForLocale = () =>
  useRetirementPlannerStore((state) => state.setDesiredIncomeForLocale)

export const useSetAdoptedMonthlyCents = () =>
  useRetirementPlannerStore((state) => state.setAdoptedMonthlyCents)

export const useSetIncomeBasis = () => useRetirementPlannerStore((state) => state.setIncomeBasis)

export const useSetAnnualReturnInput = () =>
  useRetirementPlannerStore((state) => state.setAnnualReturnInput)

export const useSetPostRetirementReturn = () =>
  useRetirementPlannerStore((state) => state.setPostRetirementReturn)

export const useSetModel = () => useRetirementPlannerStore((state) => state.setModel)
