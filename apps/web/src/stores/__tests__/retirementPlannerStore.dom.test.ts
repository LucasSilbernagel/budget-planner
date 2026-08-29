/**
 * Persisted retirement plan (Story 44.1, FR71).
 *
 * ⚠️ EVERY CORRUPT CASE RUNS AT BOTH VERSIONS. At `RETIREMENT_PLANNER_VERSION`
 * the blob bypasses `migrate` entirely — that is the path a real corrupt payload
 * takes (a truncated write, hand-edited storage, another build). Seeding only at
 * a mismatching version tests the seam and not the guard. Story 42.1 proved this
 * the hard way: deleting `migrate` outright left its store suite fully green.
 *
 * ⚠️ ROUND-TRIP FIXTURES NEVER USE THE DEFAULTS. A test that stores `'35'` and
 * asserts `'35'` cannot tell "restored" from "defaulted" and passes against a
 * store that persists nothing at all.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  RETIREMENT_PLANNER_STORAGE_KEY,
  RETIREMENT_PLANNER_VERSION,
  coerceRetirementPlan,
  useRetirementPlannerStore,
} from '../retirementPlannerStore'

/** A complete plan in which NO field equals its default. */
const SAVED_PLAN = {
  currentAgeInput: '42',
  lifeExpectancyInput: '88',
  desiredIncomeInput: '55,000.00',
  desiredIncomeTouched: true,
  desiredIncomeLocale: 'en-US',
  incomeBasis: 'monthly',
  annualReturnInput: '7.5',
  postRetirementReturnInput: '3.25',
  postRetirementTouched: true,
  model: 'perpetual',
} as const

/**
 * Seed a pre-serialized blob VERBATIM.
 *
 * ⚠️ REQUIRED FOR THE PROTOTYPE-KEY CASES, and the reason is why the first
 * version of those tests was vacuous. In an object LITERAL, `__proto__:` is
 * prototype-setting syntax rather than a key, and `JSON.stringify` serializes
 * own enumerable properties only — so `seed({ __proto__: { ... } })` stores
 * `{"state":{"plan":{}}}` and silently re-runs the empty-object case. Only a raw
 * string survives `JSON.parse` as a real own `"__proto__"` key.
 */
function seedRaw(json: string): void {
  localStorage.setItem(RETIREMENT_PLANNER_STORAGE_KEY, json)
}

/** Seed a raw persisted blob, bypassing the store's own writer. */
function seed(plan: unknown, version: number = RETIREMENT_PLANNER_VERSION): void {
  localStorage.setItem(RETIREMENT_PLANNER_STORAGE_KEY, JSON.stringify({ state: { plan }, version }))
}

beforeEach(() => {
  localStorage.clear()
  // zustand stores are module singletons shared across every test file in the
  // process — reset the in-memory state, not just storage.
  useRetirementPlannerStore.getState().resetPlan()
  // ⚠️ ORDER MATTERS. `resetPlan` goes through `set`, which WRITES through the
  // persist path (`skipHydration` skips only the initial READ), so the line above
  // re-creates the storage key `localStorage.clear()` just removed. Left as-is,
  // the "absent key" test below rehydrates a PRESENT, valid blob and cannot fail
  // against an absent-path defect. Remove it last.
  localStorage.removeItem(RETIREMENT_PLANNER_STORAGE_KEY)
})

describe('retirementPlannerStore defaults (AC-2)', () => {
  it('opens on age 35 and life expectancy 90', () => {
    const { plan } = useRetirementPlannerStore.getInitialState()
    expect(plan.currentAgeInput).toBe('35')
    expect(plan.lifeExpectancyInput).toBe('90')
  })

  it('leaves the pre-existing 6.0% and deplete defaults unchanged', () => {
    const { plan } = useRetirementPlannerStore.getInitialState()
    expect(plan.annualReturnInput).toBe('6.0')
    expect(plan.model).toBe('deplete')
    expect(plan.incomeBasis).toBe('annual')
  })

  it('starts the post-retirement rate EMPTY and untouched so it mirrors', () => {
    const { plan } = useRetirementPlannerStore.getInitialState()
    // A literal '6.0' here would end the mirror on the very first render — the
    // hazard RetirementAccumulationPlanner's own comment records (story 35.3).
    expect(plan.postRetirementReturnInput).toBe('')
    expect(plan.postRetirementTouched).toBe(false)
  })

  it('starts desired income empty and untouched', () => {
    const { plan } = useRetirementPlannerStore.getInitialState()
    expect(plan.desiredIncomeInput).toBe('')
    expect(plan.desiredIncomeTouched).toBe(false)
  })
})

describe('retirementPlannerStore writes', () => {
  it('persists a payload holding exactly the partialized keys', () => {
    useRetirementPlannerStore.getState().setCurrentAgeInput('42')
    const raw = localStorage.getItem(RETIREMENT_PLANNER_STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.version).toBe(RETIREMENT_PLANNER_VERSION)
    expect(Object.keys(parsed.state)).toEqual(['plan'])
    expect(parsed.state.plan.currentAgeInput).toBe('42')
  })

  it('accepts an updater function, the shape reEcho and sanitizeMoneyChange need', () => {
    useRetirementPlannerStore.getState().setDesiredIncomeInput('1234')
    useRetirementPlannerStore.getState().setDesiredIncomeInput((prev) => `${prev}.56`)
    expect(useRetirementPlannerStore.getState().plan.desiredIncomeInput).toBe('1234.56')
  })

  it('sets the touched flag as it writes the post-retirement rate (AC-3)', () => {
    // One writer for both halves: persisting the rate without the flag restores
    // a plan whose own hint contradicts it.
    useRetirementPlannerStore.getState().setPostRetirementReturn('3.0')
    const { plan } = useRetirementPlannerStore.getState()
    expect(plan.postRetirementReturnInput).toBe('3.0')
    expect(plan.postRetirementTouched).toBe(true)
  })

  it('keeps the touched latch set when the rate is cleared', () => {
    useRetirementPlannerStore.getState().setPostRetirementReturn('3.0')
    useRetirementPlannerStore.getState().setPostRetirementReturn('')
    const { plan } = useRetirementPlannerStore.getState()
    expect(plan.postRetirementReturnInput).toBe('')
    // Nothing ever resets it — clearing the field is an edit, not an un-edit.
    expect(plan.postRetirementTouched).toBe(true)
  })

  it('resetPlan returns every field to its default', () => {
    useRetirementPlannerStore.getState().setCurrentAgeInput('42')
    useRetirementPlannerStore.getState().setModel('perpetual')
    useRetirementPlannerStore.getState().resetPlan()
    expect(useRetirementPlannerStore.getState().plan).toEqual(
      useRetirementPlannerStore.getInitialState().plan
    )
  })
})

describe('retirementPlannerStore rehydration (AC-1)', () => {
  it('restores every saved field', async () => {
    seed(SAVED_PLAN)
    await expect(useRetirementPlannerStore.persist.rehydrate()).resolves.not.toThrow()
    expect(useRetirementPlannerStore.getState().plan).toEqual(SAVED_PLAN)
  })

  it('restores a plan written at a mismatching version through migrate', async () => {
    seed(SAVED_PLAN, RETIREMENT_PLANNER_VERSION + 7)
    await expect(useRetirementPlannerStore.persist.rehydrate()).resolves.not.toThrow()
    expect(useRetirementPlannerStore.getState().plan).toEqual(SAVED_PLAN)
  })
})

describe('deliberately cleared fields (AC-4)', () => {
  // ⚠️ These are the tests a `||` fallback breaks and nothing else does.
  const CLEARABLE = [
    'currentAgeInput',
    'lifeExpectancyInput',
    'desiredIncomeInput',
    'annualReturnInput',
  ] as const

  it.each(CLEARABLE)('a persisted empty %s stays empty', async (field) => {
    seed({ ...SAVED_PLAN, [field]: '' })
    await useRetirementPlannerStore.persist.rehydrate()
    expect(useRetirementPlannerStore.getState().plan[field]).toBe('')
  })

  it.each(CLEARABLE)('an ABSENT %s falls back to its default', async (field) => {
    const { [field]: _omitted, ...withoutField } = SAVED_PLAN
    seed(withoutField)
    await useRetirementPlannerStore.persist.rehydrate()
    expect(useRetirementPlannerStore.getState().plan[field]).toBe(
      useRetirementPlannerStore.getInitialState().plan[field]
    )
  })

  it('distinguishes absent from empty on the same field in one payload', async () => {
    // The pair that makes the distinction observable rather than asserted twice.
    const { currentAgeInput: _omitted, ...rest } = SAVED_PLAN
    seed({ ...rest, lifeExpectancyInput: '' })
    await useRetirementPlannerStore.persist.rehydrate()
    const { plan } = useRetirementPlannerStore.getState()
    expect(plan.currentAgeInput).toBe('35')
    expect(plan.lifeExpectancyInput).toBe('')
  })
})

describe('corrupt, absent and foreign payloads (AC-5)', () => {
  const CORRUPT_CASES: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['a string', 'not a plan'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}],
    ['a boolean', true],
    ['numeric field values', { ...SAVED_PLAN, currentAgeInput: 42 }],
    ['null field values', { ...SAVED_PLAN, lifeExpectancyInput: null }],
    ['object field values', { ...SAVED_PLAN, annualReturnInput: { toString: 'boom' } }],
    ['an array field value', { ...SAVED_PLAN, desiredIncomeInput: ['1', '2'] }],
    ['an unknown model', { ...SAVED_PLAN, model: 'preserve' }],
    ['an unknown income basis', { ...SAVED_PLAN, incomeBasis: 'weekly' }],
    ['a non-boolean touched flag', { ...SAVED_PLAN, postRetirementTouched: 'yes' }],
    ['a null-prototype object', Object.assign(Object.create(null), { currentAgeInput: 42 })],
    ['unknown extra keys', { ...SAVED_PLAN, injected: 'nope' }],
  ]

  describe.each([RETIREMENT_PLANNER_VERSION, 0])('at version %i', (version) => {
    it.each(CORRUPT_CASES)('%s rehydrates without throwing', async (_label, plan) => {
      seed(plan, version)
      await expect(useRetirementPlannerStore.persist.rehydrate()).resolves.not.toThrow()
    })

    it.each(CORRUPT_CASES)('%s leaves every field a usable string or literal', async (_l, plan) => {
      seed(plan, version)
      await useRetirementPlannerStore.persist.rehydrate()
      const restored = useRetirementPlannerStore.getState().plan
      // The solver's guards all run on parsed STRINGS; `parseAge` calls `.trim()`
      // on its argument, so a surviving non-string is a TypeError before any
      // guard fires. This is the "never hand the solver a value it cannot read"
      // half of AC-5.
      expect(typeof restored.currentAgeInput).toBe('string')
      expect(typeof restored.lifeExpectancyInput).toBe('string')
      expect(typeof restored.desiredIncomeInput).toBe('string')
      expect(typeof restored.annualReturnInput).toBe('string')
      expect(typeof restored.postRetirementReturnInput).toBe('string')
      expect(typeof restored.postRetirementTouched).toBe('boolean')
      expect(typeof restored.desiredIncomeTouched).toBe('boolean')
      expect(['deplete', 'perpetual']).toContain(restored.model)
      expect(['monthly', 'annual']).toContain(restored.incomeBasis)
    })
  })

  it('drops an unknown key rather than carrying it into state', async () => {
    seed({ ...SAVED_PLAN, injected: 'nope' })
    await useRetirementPlannerStore.persist.rehydrate()
    expect(useRetirementPlannerStore.getState().plan).toEqual(SAVED_PLAN)
  })

  // ⚠️ Seeded as a RAW STRING, not an object literal — see `seedRaw`. The literal
  // form serializes to `{}` and makes this assertion unfailable.
  it.each([
    ['__proto__', '{"state":{"plan":{"__proto__":{"currentAgeInput":"polluted"}}},"version":1}'],
    [
      'constructor',
      '{"state":{"plan":{"constructor":{"currentAgeInput":"polluted"}}},"version":1}',
    ],
    ['prototype', '{"state":{"plan":{"prototype":{"currentAgeInput":"polluted"}}},"version":1}'],
    ['toString', '{"state":{"plan":{"toString":"polluted"}},"version":1}'],
  ])('a real own %s key never reaches a field', async (_label, raw) => {
    seedRaw(raw)
    await expect(useRetirementPlannerStore.persist.rehydrate()).resolves.not.toThrow()
    expect(useRetirementPlannerStore.getState().plan.currentAgeInput).toBe('35')
    expect(Object.getPrototypeOf(useRetirementPlannerStore.getState().plan)).toBe(Object.prototype)
  })

  it('a real own __proto__ key is genuinely present in the parsed payload', () => {
    // The control. Without it the tests above could be passing because the
    // fixture is inert again rather than because the guard works.
    const parsed = JSON.parse('{"plan":{"__proto__":{"currentAgeInput":"polluted"}}}').plan
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true)
  })

  it('opens on defaults when the stored value is not JSON', async () => {
    localStorage.setItem(RETIREMENT_PLANNER_STORAGE_KEY, 'not json at all{{{')
    await expect(useRetirementPlannerStore.persist.rehydrate()).resolves.not.toThrow()
    expect(useRetirementPlannerStore.getState().plan).toEqual(
      useRetirementPlannerStore.getInitialState().plan
    )
  })

  it('opens on defaults when the key is absent, from a live plan', async () => {
    // Seed a real plan first so "still the defaults afterwards" is a genuine
    // transition rather than a state that was already true.
    seed(SAVED_PLAN)
    await useRetirementPlannerStore.persist.rehydrate()
    expect(useRetirementPlannerStore.getState().plan.currentAgeInput).toBe('42')

    localStorage.removeItem(RETIREMENT_PLANNER_STORAGE_KEY)
    await expect(useRetirementPlannerStore.persist.rehydrate()).resolves.not.toThrow()
    expect(useRetirementPlannerStore.getState().plan).toEqual(
      useRetirementPlannerStore.getInitialState().plan
    )
  })
})

describe('coerceRetirementPlan coherence (AC-3)', () => {
  it('collapses the incoherent untouched-but-set region', () => {
    // `postRetirementTouched: false` makes the component read the MIRROR, so a
    // stored rate alongside it is invisible state that would spring back if any
    // future path flipped the flag without writing the value
    // (deferred-work.md:63). Resolve it on the way in, not by guarding later.
    const plan = coerceRetirementPlan({
      ...SAVED_PLAN,
      postRetirementReturnInput: '3.25',
      postRetirementTouched: false,
    })
    expect(plan.postRetirementTouched).toBe(false)
    expect(plan.postRetirementReturnInput).toBe('')
  })

  it('leaves a touched rate alone', () => {
    const plan = coerceRetirementPlan(SAVED_PLAN)
    expect(plan.postRetirementTouched).toBe(true)
    expect(plan.postRetirementReturnInput).toBe('3.25')
  })
})

describe('the desired-income locale travels with its string (AC-5, code review)', () => {
  it('restores the locale the figure was written in', async () => {
    seed(SAVED_PLAN)
    await useRetirementPlannerStore.persist.rehydrate()
    expect(useRetirementPlannerStore.getState().plan.desiredIncomeLocale).toBe('en-US')
  })

  it('defaults to no recorded locale when the payload omits it', async () => {
    const { desiredIncomeLocale: _omitted, ...withoutLocale } = SAVED_PLAN
    seed(withoutLocale)
    await useRetirementPlannerStore.persist.rehydrate()
    // `''` means "nothing authored under a known locale", which the component
    // reads as "do not attempt a conversion".
    expect(useRetirementPlannerStore.getState().plan.desiredIncomeLocale).toBe('')
  })

  it('writes the value and its locale together', () => {
    useRetirementPlannerStore.getState().setDesiredIncomeForLocale('55.000,00', 'de-DE')
    const { plan } = useRetirementPlannerStore.getState()
    expect(plan.desiredIncomeInput).toBe('55.000,00')
    expect(plan.desiredIncomeLocale).toBe('de-DE')
  })

  it('records the locale when the user authors the figure', () => {
    useRetirementPlannerStore.getState().markDesiredIncomeAuthored('de-DE')
    const { plan } = useRetirementPlannerStore.getState()
    expect(plan.desiredIncomeTouched).toBe(true)
    expect(plan.desiredIncomeLocale).toBe('de-DE')
  })
})
