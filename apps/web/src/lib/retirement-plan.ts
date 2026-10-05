/**
 * The retirement plan's SHAPE, its defaults and its coercion (story 99.2 moved
 * them here from `stores/retirementPlannerStore.ts`, which re-exports all three,
 * so existing imports keep working).
 *
 * ⚠️ STORE-FREE, and that is why this module exists. The sync bridge
 * (`lib/sync/syncBridge.ts`, whose `toServerPayload` coerces the plan it sends)
 * must import no store: stores import the bridge, so a bridge → store import is a
 * cycle, and `components/sync/__tests__/cross-device-sync.db.test.tsx` imports
 * every store concurrently, where a cycle DEADLOCKS (60 s `beforeAll` timeout,
 * tests skipped). This module imports only core.
 *
 * The plan is persisted per device (story 44.1) and, since story 99.2, also held
 * by the server for premium accounts (one `retirementPlans` row per account, the
 * whole plan in one jsonb column). The pull applier rebuilds every pulled plan
 * through {@link coerceRetirementPlan}, so the field set below is also the field
 * set the sync push gate (`retirementPlanSyncSchema`) declares: a test pins the
 * two key for key.
 */

import {
  INCOME_BASES,
  type IncomeBasis,
  RETIREMENT_MODELS,
  type RetirementModel,
} from '@budget-planner/core'

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
  /**
   * The MONTHLY cents the user last adopted from the "expenses ending before
   * retirement" suggestion, or `null` if they never did (or have since typed).
   *
   * ⚠️⚠️ PERSISTED, and that is the whole point (story 65.2, second review round).
   * Adopting must call `markDesiredIncomeAuthored`, or the income seed reclaims
   * the number — but `desiredIncomeTouched` is ALSO what stops the seed effect
   * re-expressing the field when the basis changes, so an adopted value was
   * stranded in the basis it was adopted in: adopt 28,800.00 under Annual, switch
   * to Monthly, and the field still read 28,800.00 while the sentence beneath it
   * said 2,400.00 a month — a 12x overstatement of the plan's central figure.
   *
   * The first fix held this in COMPONENT state, which closed the defect only
   * while `/retirement` stayed mounted — and it unmounts on every route change,
   * so one navigation brought the 12x error straight back. All three review
   * layers reached that independently and one MEASURED it. Persisting it beside
   * the value it describes is what actually closes it.
   *
   * ⚠️ No version bump: `coerceRetirementPlan` rebuilds every field with a
   * default, so a pre-65.2 blob simply yields `null` — which is exactly "never
   * adopted". Same reasoning as the expense store's D3.
   */
  adoptedMonthlyCents: number | null
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
  adoptedMonthlyCents: null,
  desiredIncomeLocale: '',
  incomeBasis: 'annual',
  annualReturnInput: '6.0',
  postRetirementReturnInput: '',
  postRetirementTouched: false,
  model: 'deplete',
}

// ONE exported constant per enum, shared with the sync push gate
// (`retirementPlanSyncSchema` in core), so a value added to one cannot be refused
// by the other (schema-as-gate trap 3).
const VALID_MODELS: readonly RetirementModel[] = RETIREMENT_MODELS
const VALID_INCOME_BASES: readonly IncomeBasis[] = INCOME_BASES

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

/**
 * A persisted adopted figure, or `null`.
 *
 * Rejects anything that is not a non-negative safe integer whose ×12 is also a
 * safe integer — the same bound `summarizeEndingExpenses` applies, because this
 * value reaches the same `toAnnualIncomeCents` call on the render path.
 */
export function coerceAdoptedCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null
  }
  return Number.isSafeInteger(value * 12) ? value : null
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
    // ⚠️ Safe-integer, not merely finite: this value is multiplied by 12 on the
    // render path (`toAnnualIncomeCents`, which THROWS outside the safe range),
    // and localStorage is user-editable. A corrupt blob must degrade to "never
    // adopted", not to a crash on the retirement route.
    adoptedMonthlyCents: coerceAdoptedCents(readField(record, 'adoptedMonthlyCents')),
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
