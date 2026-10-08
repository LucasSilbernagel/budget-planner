/**
 * Corrupt cases run at both versions: at the current version the blob bypasses migrate.
 * Round-trip fixtures never use the defaults, or restored and defaulted look the same.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  RETIREMENT_PLANNER_STORAGE_KEY,
  RETIREMENT_PLANNER_VERSION,
  claimRetirementPlanFor,
  coerceRetirementPlan,
  useRetirementPlannerStore,
} from '../retirementPlannerStore'

/** A complete plan in which NO field equals its default. */
const SAVED_PLAN = {
  currentAgeInput: '42',
  lifeExpectancyInput: '88',
  desiredIncomeInput: '55,000.00',
  desiredIncomeTouched: true,
  // Persisted so it survives the route change that unmounts the planner.
  adoptedMonthlyCents: 240_000,
  desiredIncomeLocale: 'en-US',
  incomeBasis: 'monthly',
  annualReturnInput: '7.5',
  postRetirementReturnInput: '3.25',
  postRetirementTouched: true,
  model: 'perpetual',
} as const

/**
 * In an object literal `__proto__:` sets the prototype and JSON.stringify drops it; only a raw
 * string yields a real own `"__proto__"` key.
 */
function seedRaw(json: string): void {
  localStorage.setItem(RETIREMENT_PLANNER_STORAGE_KEY, json)
}

function seed(plan: unknown, version: number = RETIREMENT_PLANNER_VERSION): void {
  localStorage.setItem(RETIREMENT_PLANNER_STORAGE_KEY, JSON.stringify({ state: { plan }, version }))
}

beforeEach(() => {
  localStorage.clear()
  // zustand stores are module singletons shared across every test file in the
  // process — reset the in-memory state, not just storage.
  useRetirementPlannerStore.getState().resetPlan()
  // Order matters: resetPlan writes through persist and re-creates the key. Remove it last.
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
    // A literal '6.0' would end the mirror on the very first render.
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
    expect(Object.keys(parsed.state)).toEqual(['plan', 'ownerUserId'])
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
      // parseAge calls `.trim()`, so a surviving non-string is a TypeError before any guard fires.
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

  // A raw string, not an object literal (see seedRaw); the literal form serializes to `{}`.
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
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
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

describe('the adopted figure (story 65.2)', () => {
  async function restore(plan: unknown) {
    seed(plan)
    await useRetirementPlannerStore.persist.rehydrate()
    return useRetirementPlannerStore.getState().plan
  }

  it('a pre-65.2 blob with no key at all restores as "never adopted", not as a crash', async () => {
    // coerceRetirementPlan rebuilds every field from a default, so an older payload yields null
    // (never adopted) with no version bump.
    const { adoptedMonthlyCents: _absent, ...withoutKey } = SAVED_PLAN
    expect((await restore(withoutKey)).adoptedMonthlyCents).toBeNull()
  })

  it.each([
    ['a string', '240000'],
    ['a negative', -1],
    ['a fraction', 240_000.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
    ['an object', { cents: 240_000 }],
  ])('refuses %s rather than carrying it to the render path', async (_label, value) => {
    // Multiplied by 12 during render (throws outside the safe-integer range), so a corrupt value must
    // degrade to never adopted.
    expect(
      (await restore({ ...SAVED_PLAN, adoptedMonthlyCents: value })).adoptedMonthlyCents
    ).toBeNull()
  })

  it('refuses a value whose x12 leaves the safe-integer range', async () => {
    const restored = await restore({ ...SAVED_PLAN, adoptedMonthlyCents: 800_000_000_000_000 })
    expect(restored.adoptedMonthlyCents).toBeNull()
  })

  it('keeps a legitimate adopted figure', async () => {
    expect(
      (await restore({ ...SAVED_PLAN, adoptedMonthlyCents: 240_000 })).adoptedMonthlyCents
    ).toBe(240_000)
  })
})

describe('coerceRetirementPlan coherence (AC-3)', () => {
  it('collapses the incoherent untouched-but-set region', () => {
    // With postRetirementTouched false the mirror is read, so a stored rate would be invisible
    // state that could spring back.
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

/** Every test resets it explicitly: resetPlan (in beforeEach) leaves it alone. */
describe('serverUpdatedAt (story 99.2)', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-8222-222222222222'
  const PULLED = '2026-10-05T12:00:00.000Z'

  beforeEach(() => {
    useRetirementPlannerStore.setState({ ownerUserId: '', serverUpdatedAt: null })
    localStorage.removeItem(RETIREMENT_PLANNER_STORAGE_KEY)
  })

  function persistedState(): Record<string, unknown> {
    const raw = localStorage.getItem(RETIREMENT_PLANNER_STORAGE_KEY)
    return (JSON.parse(raw ?? '{}') as { state: Record<string, unknown> }).state
  }

  it('is NOT persisted while null: a never-synced device writes the same keys as before 99.2', () => {
    useRetirementPlannerStore.getState().setCurrentAgeInput('44')
    expect(Object.keys(persistedState()).sort()).toEqual(['ownerUserId', 'plan'])
  })

  it('is persisted once set, and rehydrates', async () => {
    useRetirementPlannerStore.setState({ ownerUserId: OWNER, serverUpdatedAt: PULLED })
    expect(persistedState()['serverUpdatedAt']).toBe(PULLED)
    // Clearing the in-memory value WRITES through persist (a blob without the
    // field), so put the saved blob back before rehydrating from it.
    const saved = localStorage.getItem(RETIREMENT_PLANNER_STORAGE_KEY) as string
    useRetirementPlannerStore.setState({ serverUpdatedAt: null })
    localStorage.setItem(RETIREMENT_PLANNER_STORAGE_KEY, saved)
    await useRetirementPlannerStore.persist.rehydrate()
    expect(useRetirementPlannerStore.getState().serverUpdatedAt).toBe(PULLED)
  })

  it.each([
    ['a number', 1_696_000_000_000],
    ['an unparseable string', 'yesterday-ish'],
    ['an object', { at: PULLED }],
  ])('a persisted %s rehydrates as null ("never pulled")', async (_label, value) => {
    // In-memory value first: `setState` writes through persist.
    useRetirementPlannerStore.setState({ serverUpdatedAt: PULLED })
    localStorage.setItem(
      RETIREMENT_PLANNER_STORAGE_KEY,
      JSON.stringify({
        state: { plan: {}, ownerUserId: OWNER, serverUpdatedAt: value },
        version: RETIREMENT_PLANNER_VERSION,
      })
    )
    await useRetirementPlannerStore.persist.rehydrate()
    expect(useRetirementPlannerStore.getState().serverUpdatedAt).toBeNull()
  })

  it('claimRetirementPlanFor resets it on an owner change (another account)', () => {
    useRetirementPlannerStore.setState({ ownerUserId: OWNER, serverUpdatedAt: PULLED })
    claimRetirementPlanFor(OTHER)
    expect(useRetirementPlannerStore.getState().ownerUserId).toBe(OTHER)
    expect(useRetirementPlannerStore.getState().serverUpdatedAt).toBeNull()
  })

  it('claimRetirementPlanFor resets it when a session adopts an unclaimed plan', () => {
    useRetirementPlannerStore.setState({ ownerUserId: '', serverUpdatedAt: PULLED })
    claimRetirementPlanFor(OWNER)
    expect(useRetirementPlannerStore.getState().serverUpdatedAt).toBeNull()
  })

  it('CONTROL: the same owner keeps it', () => {
    useRetirementPlannerStore.setState({ ownerUserId: OWNER, serverUpdatedAt: PULLED })
    claimRetirementPlanFor(OWNER)
    expect(useRetirementPlannerStore.getState().serverUpdatedAt).toBe(PULLED)
  })
})
