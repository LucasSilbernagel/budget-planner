import type { IncomeBasis, RetirementModel } from '@budget-planner/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The persisted retirement plan (Story 44.1, FR71).
 *
 * ## What this stores
 *
 * The nine values the user authors on `/retirement`. Before this store they were
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
 * It is also a per-device CLIENT preference: no `packages/core` call, no
 * `sync.ts`, no `syncBridge`, no DB column.
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

/** The user-authored half of the retirement planner. */
export interface RetirementPlan {
  /** Raw age input. `''` is "cleared", which is NOT the same as absent. */
  currentAgeInput: string
  /** Raw life-expectancy input. */
  lifeExpectancyInput: string
  /** Raw desired-income input, under {@link RetirementPlan.incomeBasis}. */
  desiredIncomeInput: string
  /**
   * Whether the user has ever typed in the desired-income field.
   *
   * ⚠️ LOAD-BEARING FOR PERSISTENCE, and the reason this field exists at all.
   * The planner seeds desired income from a prefill derived from the INCOME
   * store, in an effect that re-fires whenever that prefill recomputes. The
   * income store rehydrates in the same `StoreHydration` pass as this one, so
   * the prefill goes null -> real on every single visit and the effect would
   * overwrite the number the user saved. The failure is silent and hits only
   * users who have income rows. `deferred-work.md:643` records the identical
   * shape on the sibling `RetirementForm`, and names this fix: stop seeding once
   * the user has authored a value.
   */
  desiredIncomeTouched: boolean
  /**
   * The locale {@link RetirementPlan.desiredIncomeInput} is FORMATTED IN.
   *
   * ⚠️ WITHOUT THIS THE PLAN'S CENTRAL FIGURE SILENTLY RESCALES (story 44.1 code
   * review). This is the only store in the app that persists a DISPLAY STRING
   * rather than integer cents, and the string's meaning depends on the locale it
   * was written under: `'55.000,00'` authored on EUR/de-DE reparses under en-US
   * as **5500 cents — $55 instead of €55,000**, and `'1234,56'` reparses as
   * $123,456. The currency (and therefore the locale) is user-changeable in
   * Settings, so this is a two-click path, not a hypothetical.
   *
   * Before 44.1 the string could not survive the trip to Settings — the route
   * change destroyed it — so persistence is what made this reachable, and this
   * story owns it. `''` means "no locale recorded yet" (nothing authored).
   */
  desiredIncomeLocale: string
  /** Whether the desired income is read as a monthly or an annual figure. */
  incomeBasis: IncomeBasis
  /** Raw accumulation-phase return input, as a percentage. */
  annualReturnInput: string
  /**
   * Raw post-retirement return input.
   *
   * ⚠️ Meaningless without {@link RetirementPlan.postRetirementTouched}. Empty
   * while mirroring; see that field.
   */
  postRetirementReturnInput: string
  /**
   * Whether the user has edited the post-retirement rate (story 35.3).
   *
   * Until they have, the field MIRRORS the accumulation rate and its hint says
   * so. Persisting the rate without this flag restores a plan whose own hint
   * contradicts it, which is why {@link RETIREMENT_PLAN_DEFAULTS} keeps the pair
   * coherent and {@link coerceRetirementPlan} re-establishes that on every load.
   *
   * It is a one-way latch: nothing resets it to `false`, because clearing the
   * field is an edit and not an un-edit.
   */
  postRetirementTouched: boolean
  /** Which retirement target model the plan solves for. */
  model: RetirementModel
}

/**
 * The plan a first-time user opens on.
 *
 * ⚠️ THE SINGLE SOURCE OF TRUTH FOR THE PERSISTED FIELD SET, and the drift guard
 * is the type system rather than a derived constant: {@link coerceRetirementPlan}
 * is annotated `: RetirementPlan`, so a field added to the interface and not to
 * the coercion is a compile error. (An earlier draft exported a derived
 * `PLAN_FIELDS` and claimed it played that role; nothing consumed it, so it was
 * removed rather than left as a comment asserting a guard that did not exist.)
 *
 * `35` and `90` are new in story 44.1 (FR71) — the field was `''` behind a
 * placeholder. `'6.0'` and `'deplete'` are pre-existing and unchanged; they only
 * needed to survive persistence.
 *
 * ⚠️ The post-retirement rate starts EMPTY, not `'6.0'`: a literal would end the
 * mirror on the very first render (story 35.3).
 */
export const RETIREMENT_PLAN_DEFAULTS: RetirementPlan = {
  currentAgeInput: '35',
  lifeExpectancyInput: '90',
  desiredIncomeInput: '',
  desiredIncomeTouched: false,
  desiredIncomeLocale: '',
  incomeBasis: 'annual',
  annualReturnInput: '6.0',
  postRetirementReturnInput: '',
  postRetirementTouched: false,
  model: 'deplete',
}

const VALID_MODELS: readonly RetirementModel[] = ['deplete', 'perpetual']
const VALID_INCOME_BASES: readonly IncomeBasis[] = ['annual', 'monthly']

/**
 * Read one persisted field, or fall back to its default.
 *
 * ⚠️ `absent -> default` and `'' -> preserved` are BOTH acceptance criteria, and
 * they are what forces the `typeof` test here. The tempting shorthand
 * `record[field] || fallback` re-defaults a field the user deliberately cleared,
 * and every other test in this file still passes when it does.
 */
function readField(record: Record<string, unknown>, field: keyof RetirementPlan): unknown {
  // `hasOwnProperty.call`, not `Object.hasOwn`: the app's tsconfig `lib` is below
  // es2022. Not a style choice — `Object.hasOwn` type-checks red here. It is also
  // what stops a `__proto__` entry in the parsed JSON reaching a field.
  return Object.prototype.hasOwnProperty.call(record, field) ? record[field] : undefined
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function coerceMember<T extends string>(value: unknown, valid: readonly T[], fallback: T): T {
  return valid.includes(value as T) ? (value as T) : fallback
}

/**
 * Rebuild a whole plan from {@link RETIREMENT_PLAN_DEFAULTS}, reading each field
 * defensively.
 *
 * Building FROM the known fields rather than from the payload's own keys is what
 * drops an injected key, and the own-property check is what stops a
 * `__proto__` entry reaching a field.
 */
export function coerceRetirementPlan(value: unknown): RetirementPlan {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  const d = RETIREMENT_PLAN_DEFAULTS
  const postRetirementTouched = coerceBoolean(
    readField(record, 'postRetirementTouched'),
    d.postRetirementTouched
  )

  return {
    currentAgeInput: coerceString(readField(record, 'currentAgeInput'), d.currentAgeInput),
    lifeExpectancyInput: coerceString(
      readField(record, 'lifeExpectancyInput'),
      d.lifeExpectancyInput
    ),
    desiredIncomeInput: coerceString(readField(record, 'desiredIncomeInput'), d.desiredIncomeInput),
    desiredIncomeTouched: coerceBoolean(
      readField(record, 'desiredIncomeTouched'),
      d.desiredIncomeTouched
    ),
    desiredIncomeLocale: coerceString(
      readField(record, 'desiredIncomeLocale'),
      d.desiredIncomeLocale
    ),
    incomeBasis: coerceMember(readField(record, 'incomeBasis'), VALID_INCOME_BASES, d.incomeBasis),
    annualReturnInput: coerceString(readField(record, 'annualReturnInput'), d.annualReturnInput),
    // ⚠️ Untouched means MIRRORING, and while mirroring the component reads the
    // accumulation rate and never this value — so a stored rate alongside
    // `touched: false` is invisible state that would spring back if any future
    // path flipped the flag without writing a value. `deferred-work.md:63`
    // describes exactly that hidden-stale-value region. Collapse it on the way
    // in rather than guarding against it forever afterwards.
    postRetirementReturnInput: postRetirementTouched
      ? coerceString(readField(record, 'postRetirementReturnInput'), d.postRetirementReturnInput)
      : '',
    postRetirementTouched,
    model: coerceMember(readField(record, 'model'), VALID_MODELS, d.model),
  }
}

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
      partialize: (state) => ({ plan: state.plan }),
      version: RETIREMENT_PLANNER_VERSION,
      // The seam for a future shape change. See the module docblock: this is NOT
      // the corrupt-payload guard, because it does not run at the current version.
      migrate: (persisted) => ({
        plan: coerceRetirementPlan((persisted as { plan?: unknown } | undefined)?.plan),
      }),
      // Runs on EVERY rehydrate. This is the guard: a corrupt, absent or foreign
      // payload opens the planner on defaults rather than throwing, and no field
      // reaches the parsers as anything but a string or a known literal.
      merge: (persisted, current) => ({
        ...current,
        plan: coerceRetirementPlan((persisted as { plan?: unknown } | undefined)?.plan),
      }),
    }
  )
)

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

export const useSetIncomeBasis = () => useRetirementPlannerStore((state) => state.setIncomeBasis)

export const useSetAnnualReturnInput = () =>
  useRetirementPlannerStore((state) => state.setAnnualReturnInput)

export const useSetPostRetirementReturn = () =>
  useRetirementPlannerStore((state) => state.setPostRetirementReturn)

export const useSetModel = () => useRetirementPlannerStore((state) => state.setModel)
