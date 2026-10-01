import { render } from '@testing-library/react'
import { type ReactElement, cloneElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCurrencyStore } from '../../stores/currencyStore'

/**
 * "Your Savings Until Retirement" is labelled by AGE, with the REAL chart
 * library (was `e2e/retirement-age-axis.spec.ts`, story 44.3 UX-DR50; moved by
 * story 84.5, FR137).
 *
 * ⚠️ Recharts renders no SVG under jsdom's 0×0 `ResponsiveContainer`, which is
 * why this used to be e2e-only. Here ONLY `ResponsiveContainer` is replaced, by
 * one that hands its chart a fixed 600×300, and the real `LineChart`, axes and
 * `ReferenceLine` render (MEASURED at 84.5 Task 1: tick text 40..50, titles
 * Age/Assets/Retirement, the reference line at the age-45 category).
 *
 * The claims that REVERSE on a revert, all of them structural:
 *   - tick TEXT reads ages from the current age to the last projected age (a
 *     revert to years-from-now reads 0..10, every tick below the current age);
 *   - the "Retirement" marker sits on the tick of the solver's earliest
 *     retirement age (a revert to `x={retirementYearOffset}` names a category
 *     the axis does not have);
 *   - the axis title reads "Age" on a wide viewport.
 *
 * ⚠️ What is NOT pinned (the named D2 loss): Recharts THINS ticks by MEASURED
 * text width, and jsdom measures no text, so every tick renders here; the
 * e2e file's AC-5/AC-6 bounds were font-dependent floors, not reversals.
 * Hovering a dot is a D2 loss too; the tooltip HEADER is pinned in
 * `RetirementTimelineChart.test.tsx` (`CustomTooltip`).
 */

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 600, height: 300 } as never),
  }
})

const { RetirementTimelineChart } = await import('../RetirementTimelineChart')

/** Solvable and reachable: $100,000 saved, $1,000/mo, 6%, age 40, 10 years, retire at 45. */
const PROPS = {
  currentSavedCents: 100_000_00,
  monthlySavingsCents: 1_000_00,
  annualReturnRate: 0.06,
  currentAge: 40,
  yearsToProject: 10,
  earliestRetirementAge: 45,
}
const FINAL_AGE = PROPS.currentAge + PROPS.yearsToProject

function ticks(container: HTMLElement): { age: number; x: number }[] {
  return [...container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick text')].map(
    (node) => ({ age: Number(node.textContent), x: Number(node.getAttribute('x')) })
  )
}

/** Narrow for WIDTH queries only: every other query (e.g. `prefers-color-scheme`)
 * answers false, so "narrow" does not also mean "dark" (84.5 code review). */
function matchNarrow(narrow: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: narrow && /max-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const originalMatchMedia = window.matchMedia

beforeEach(() => {
  useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

for (const narrow of [true, false]) {
  describe(`the age axis (${narrow ? 'narrow' : 'wide'} viewport)`, () => {
    it('plots ages from the current age to the last projected age, not years from now (was e2e retirement-age-axis:186)', () => {
      matchNarrow(narrow)
      const { container } = render(<RetirementTimelineChart {...PROPS} />)
      const ages = ticks(container).map((tick) => tick.age)

      expect(ages.length, 'no tick text rendered: the harness drew no axis').toBeGreaterThanOrEqual(
        2
      )
      for (const age of ages) {
        expect(Number.isInteger(age)).toBe(true)
        // The line that REVERSES: every years-from-now tick (0..10) is below 40.
        expect(age).toBeGreaterThanOrEqual(PROPS.currentAge)
        expect(age).toBeLessThanOrEqual(FINAL_AGE)
      }
      for (let i = 1; i < ages.length; i++) {
        expect(ages[i] as number).toBeGreaterThan(ages[i - 1] as number)
      }
      expect(ages.at(-1)).toBe(FINAL_AGE)
    })

    it('puts the "Retirement" marker on the tick of the earliest retirement age (was e2e retirement-age-axis:223)', () => {
      matchNarrow(narrow)
      const { container } = render(<RetirementTimelineChart {...PROPS} />)

      const line = container.querySelector('.recharts-reference-line line')
      expect(line, 'no reference line was drawn').not.toBeNull()
      expect(container.querySelector('.recharts-reference-line')).toHaveTextContent('Retirement')

      // Structural, not layout: both positions come from Recharts' own band
      // scale over the age categories, which jsdom computes exactly.
      const tick = ticks(container).find((t) => t.age === PROPS.earliestRetirementAge)
      expect(tick, `no tick for age ${PROPS.earliestRetirementAge}`).toBeDefined()
      expect(Number(line?.getAttribute('x1'))).toBeCloseTo(tick?.x as number, 6)
    })
  })
}

it('titles the axis "Age" on a wide viewport (was e2e retirement-age-axis:258)', () => {
  matchNarrow(false)
  const { container } = render(<RetirementTimelineChart {...PROPS} />)
  const titles = [...container.querySelectorAll('.recharts-surface .recharts-label')].map(
    (node) => node.textContent
  )
  expect(titles).toContain('Age')
  expect(titles).not.toContain('Years from Now')
})
