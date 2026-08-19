/**
 * Pre-paint planner-visibility bootstrap (story 35.2, AC-4).
 *
 * ⚠️ WHY THIS SCRIPT EXISTS AT ALL. Every persisted store in this app is
 * `skipHydration: true` and rehydrated in a mount effect, so the server and the
 * first client render MUST both paint the deterministic default (planner
 * visible). Applying the preference "after client rehydration" — the discipline
 * the epic prescribed — is therefore precisely what produces the flash it asked
 * us to avoid: the entry paints, then vanishes, on every page load. Only a
 * synchronous `<head>` script beats first paint (`ThemeProvider` documents the
 * same conclusion for the theme).
 *
 * The script is a raw string that runs before any module loads, so it cannot
 * import the store. These tests execute the ACTUAL exported string against a
 * seeded `localStorage` and assert the resulting `<html>` attribute — the
 * behaviour, not the source text.
 *
 * ⚠️ The rule under test is `=== false`, not falsiness. `'false'`, `0`, `null`
 * and a missing field must all mean SHOW, exactly as `plannerVisibilityStore`'s
 * `merge` sanitizer decides. If these two readers ever disagree, a corrupt blob
 * hides the entry on the first frame and reveals it after hydration.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { PLANNER_VISIBILITY_STORAGE_KEY } from '../../../stores/plannerVisibilityStore'
import { NO_FLASH_PLANNER_SCRIPT } from '../no-flash-planner-visibility-script'

/**
 * Run the real bootstrap string the way the browser would.
 *
 * `new Function` rather than importing a testable helper on purpose: what ships
 * is the STRING, so a test that exercised a parallel TypeScript implementation
 * could pass while the shipped script was broken.
 */
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

  /**
   * ⚠️ THE TWO-READER AGREEMENT, PINNED AT ITS ACTUAL BREAKING POINT.
   *
   * Found in review: a truthiness chain (`parsed && parsed.state &&
   * parsed.state.showRetirementPlanner`) yields the literal `false` of the STATE
   * NODE for `{"state": false}`, so `v === false` passed and the script hid the
   * planner — while the store's `merge` reads `(false)?.showRetirementPlanner`
   * as `undefined` and shows it. That is the pre-paint/post-hydration inversion
   * both modules declare impossible.
   *
   * Note the near misses that do NOT diverge and are pinned here so nobody
   * "fixes" them: `0`, `''` and `null` also short-circuit the chain, but their
   * value is not `=== false`, so both readers already agreed. Only `false`
   * itself broke it — which is exactly why an enumeration was needed instead of
   * an argument about falsiness.
   */
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

  /**
   * The script cannot import the store, so the storage key is duplicated at the
   * source level via an import in the module that BUILDS the string. This pins
   * that the built string really does carry the live key — a rename that missed
   * the script would otherwise leave it reading a key nobody writes, silently
   * restoring the flash.
   */
  it('embeds the live storage key', () => {
    expect(NO_FLASH_PLANNER_SCRIPT).toContain(PLANNER_VISIBILITY_STORAGE_KEY)
  })
})
