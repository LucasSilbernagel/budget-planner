import { act } from '@/test/utils'
import type React from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../../stores/currencyStore'
import {
  RETIREMENT_PLANNER_STORAGE_KEY,
  RETIREMENT_PLANNER_VERSION,
  useRetirementPlannerStore,
} from '../../stores/retirementPlannerStore'
import { RetirementAccumulationPlanner } from '../RetirementAccumulationPlanner'

/**
 * AC-10: does a restored plan flash its defaults first? (Story 44.1)
 *
 * ⚠️ WHY THIS FILE EXISTS AND THE OTHER TWO CANNOT ANSWER IT. RTL flushes
 * effects before the first assertion and Playwright auto-retries past a flash —
 * BOTH stay green against a real, user-visible one. Only `renderToString`, which
 * runs no effects, sees the first paint. Story 41.3 measured this exact
 * blindness; 42.1's first attempt at the same measurement produced a red probe
 * that turned out to be an artifact of its own fixture.
 *
 * ## THE OUTCOME, so nobody has to re-derive it
 *
 * There IS a swap: first paint 35, settled 42. It is accepted rather than fixed,
 * and the reasoning lives at `routes/retirement.tsx` beside the ratified
 * acceptance of the larger planner-vs-notice swap on the same route. This file
 * is the measurement that acceptance rests on — if it ever goes red because the
 * numbers changed, the decision needs re-reading, not the test re-writing.
 *
 * The plan is deliberately INCOMPLETE (no desired income) so the planner renders
 * the guidance panel rather than solving — this probe is about the input values
 * at first paint, and dragging Recharts into `renderToString` would measure the
 * chart instead.
 */

/** A saved plan whose age differs from the default, and which does not solve. */
const SAVED_PLAN = {
  currentAgeInput: '42',
  lifeExpectancyInput: '88',
  desiredIncomeInput: '',
  desiredIncomeTouched: true,
  incomeBasis: 'annual',
  annualReturnInput: '7.5',
  postRetirementReturnInput: '',
  postRetirementTouched: false,
  model: 'deplete',
} as const

function inputValueAttr(container: HTMLElement | Element, id: string): string | null {
  return container.querySelector(`#${id}`)?.getAttribute('value') ?? null
}

beforeEach(() => {
  useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  useRetirementPlannerStore.getState().resetPlan()
  localStorage.removeItem(RETIREMENT_PLANNER_STORAGE_KEY)
})

/**
 * Server-render against the un-rehydrated store, then rehydrate the way
 * `StoreHydration`'s mount effect does, then hydrate — reporting what the FIRST
 * PAINT showed and what the user ends up with.
 */
async function measureFirstPaint(Component: () => React.ReactElement) {
  const container = document.createElement('div')
  container.innerHTML = renderToString(<Component />)
  document.body.appendChild(container)

  const firstPaintAge = inputValueAttr(container, 'currentAge')

  const recoverable: string[] = []
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(container, <Component />, {
      onRecoverableError: (error) => recoverable.push(String(error)),
    })
    await useRetirementPlannerStore.persist.rehydrate()
  })

  const settledAge = (container.querySelector('#currentAge') as HTMLInputElement | null)?.value
  await act(async () => {
    root?.unmount()
  })
  container.remove()
  return { firstPaintAge, settledAge, recoverable }
}

describe('first paint of a restored plan (AC-10)', () => {
  it('MEASURED: the first paint shows the DEFAULT age, not the saved one', async () => {
    localStorage.setItem(
      RETIREMENT_PLANNER_STORAGE_KEY,
      JSON.stringify({ state: { plan: SAVED_PLAN }, version: RETIREMENT_PLANNER_VERSION })
    )

    const { firstPaintAge, settledAge, recoverable } = await measureFirstPaint(() => (
      <RetirementAccumulationPlanner />
    ))

    // ⚠️ THIS IS THE MEASUREMENT, RECORDED AS A FACT RATHER THAN A WISH.
    // The store is `skipHydration`, so the server and the first client render
    // both see `RETIREMENT_PLAN_DEFAULTS`. Unlike the tables in story 42.1 —
    // where the ROWS were absent too, so nothing rendered until both arrived —
    // this form always renders, so a saved age of 42 is preceded by one paint
    // showing 35.
    expect(firstPaintAge).toBe('35')
    expect(settledAge).toBe('42')

    // It is a value swap, NOT a hydration mismatch: server and first client
    // render agree, so React does not discard the tree (no BUG-F / React #418).
    expect(recoverable).toEqual([])
  })

  it('shows no swap at all for a first-time user', async () => {
    // The control. Without it the test above could be reporting the fixture.
    const { firstPaintAge, settledAge, recoverable } = await measureFirstPaint(() => (
      <RetirementAccumulationPlanner />
    ))

    expect(firstPaintAge).toBe('35')
    expect(settledAge).toBe('35')
    expect(recoverable).toEqual([])
  })
})
