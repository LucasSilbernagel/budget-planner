import { beforeEach, describe, expect, it } from 'vitest'
import { PLANNER_VISIBILITY_STORAGE_KEY } from '../../../stores/plannerVisibilityStore'
import { NO_FLASH_PLANNER_SCRIPT } from '../no-flash-planner-visibility-script'

/** Runs the shipped string itself, not a parallel TypeScript implementation. */
function runScript(): void {
  new Function(NO_FLASH_PLANNER_SCRIPT)()
}

function seed(state: unknown): void {
  localStorage.setItem(PLANNER_VISIBILITY_STORAGE_KEY, JSON.stringify({ state, version: 0 }))
}

const hideAttr = () => document.documentElement.getAttribute('data-hide-retirement')

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-hide-retirement')
})

describe('NO_FLASH_PLANNER_SCRIPT', () => {
  it('marks <html> when the planner is persisted as hidden', () => {
    seed({ showRetirementPlanner: false })
    runScript()
    expect(hideAttr()).toBe('1')
  })

  it('leaves <html> unmarked when the planner is persisted as visible', () => {
    seed({ showRetirementPlanner: true })
    runScript()
    expect(hideAttr()).toBeNull()
  })

  it('leaves <html> unmarked on a first-ever visit (nothing persisted)', () => {
    runScript()
    expect(hideAttr()).toBeNull()
  })

  it.each([
    ['the string "false"', 'false'],
    ['the number 0', 0],
    ['null', null],
    ['an empty string', ''],
    ['an object', {}],
  ])('does not hide the planner for %s (falsy but not false)', (_label, value) => {
    seed({ showRetirementPlanner: value })
    runScript()
    expect(hideAttr()).toBeNull()
  })

  it('does not hide the planner when the field is missing', () => {
    seed({})
    runScript()
    expect(hideAttr()).toBeNull()
  })

  it('survives a corrupt blob without throwing', () => {
    localStorage.setItem(PLANNER_VISIBILITY_STORAGE_KEY, 'not json{{')
    expect(() => runScript()).not.toThrow()
    expect(hideAttr()).toBeNull()
  })

  it('survives a blob with no state object without throwing', () => {
    localStorage.setItem(PLANNER_VISIBILITY_STORAGE_KEY, JSON.stringify({ version: 0 }))
    expect(() => runScript()).not.toThrow()
    expect(hideAttr()).toBeNull()
  })

  /** A truthiness chain yields `false` for `{"state": false}`; `0`, `''` and `null` were already safe. */
  it.each([
    ['a false state node', false],
    ['a zero state node', 0],
    ['an empty-string state node', ''],
    ['a null state node', null],
    ['an array state node', []],
  ])('does not hide the planner for %s (store-side reads these as visible)', (_label, state) => {
    localStorage.setItem(PLANNER_VISIBILITY_STORAGE_KEY, JSON.stringify({ state, version: 0 }))
    runScript()
    expect(hideAttr()).toBeNull()
  })

  it('embeds the live storage key', () => {
    expect(NO_FLASH_PLANNER_SCRIPT).toContain(PLANNER_VISIBILITY_STORAGE_KEY)
  })
})
