import { renderWithProviders, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../../stores/currencyStore'
import { RetirementAccumulationPlanner } from '../RetirementAccumulationPlanner'

/**
 * The "Retirement target model" group's STRUCTURE (Story 44.2, UX-DR49).
 *
 * ⚠️ WHAT THIS FILE CAN AND CANNOT PROVE. jsdom has no layout engine — every
 * rect is `{0,0,0,0}` — so nothing here is evidence that the label sits where it
 * should. The geometric claim lives in `e2e/retirement-model-group.spec.ts` and
 * nowhere else. Story 34.2's headline is the standing warning: "A GREEN UNIT
 * SUITE SHIPPED A REAL VISUAL REGRESSION, AND ONLY E2E CAUGHT IT."
 *
 * What jsdom CAN carry is the half that is invisible to geometry: the grouping
 * survives. A fix that produced a perfect layout while quietly turning the
 * fieldset into a `<div>` would pass every measurement in the e2e spec and
 * silently cost the radio pair its accessible name — this is the file that
 * fails on that.
 */

/** Class-TOKEN membership. `className.includes('p-4')` also matches `sm:p-4`. */
function tokens(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean)
}

/**
 * The utility a token applies, with every variant prefix and importance marker
 * removed: `sm:!p-4` -> `p-4`, `p-4!` -> `p-4`, `md:hover:surface-inset` ->
 * `surface-inset`. Used by the negative guard, where a spelling that slips
 * through is a spelling that re-creates the defect.
 */
function baseClass(token: string): string {
  return (token.split(':').pop() ?? '').replace(/^!/, '').replace(/!$/, '')
}

function renderPlanner() {
  useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  const { container } = renderWithProviders(<RetirementAccumulationPlanner />)
  const fieldset = container.querySelector('fieldset') as HTMLFieldSetElement
  const legend = container.querySelector('fieldset legend') as HTMLLegendElement
  const panel = screen.getByTestId('retirement-model-panel')
  return { container, fieldset, legend, panel }
}

describe('retirement target model grouping (AC-2)', () => {
  it('keeps the native fieldset/legend grouping', () => {
    const { fieldset, legend } = renderPlanner()
    expect(fieldset).toBeInTheDocument()
    expect(legend).toBeInTheDocument()
  })

  it('keeps the legend as the fieldset FIRST child, which is what names the group', () => {
    // ⚠️ A legend that is not the first child stops being the group's accessible
    // name while looking identical on screen — invisible to every e2e assertion.
    const { fieldset, legend } = renderPlanner()
    expect(fieldset.firstElementChild).toBe(legend)
  })

  it('exposes a group named by the legend to assistive technology', () => {
    renderPlanner()
    const group = screen.getByRole('group', { name: 'Retirement target model' })
    expect(group.tagName).toBe('FIELDSET')
    // Both options live inside that named group — the association this AC is about.
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2)
  })
})

describe('the panel moved off the fieldset (AC-1)', () => {
  it('puts the panel styling on the inner panel, not the fieldset', () => {
    const { panel } = renderPlanner()
    for (const token of ['p-4', 'surface-inset', 'rounded-lg', 'clear-both']) {
      expect(tokens(panel)).toContain(token)
    }
  })

  it('keeps the responsive grid on the panel (AC-4)', () => {
    // ⚠️ ADDED IN REVIEW. The layout moved onto this element, so the grid moved
    // with it — and nothing pinned that. The e2e suite measures the resulting
    // column COUNT; this catches the tokens going missing in a refactor that
    // never reaches a browser.
    const { panel } = renderPlanner()
    for (const token of ['grid', 'grid-cols-1', 'sm:grid-cols-2', 'gap-3']) {
      expect(tokens(panel)).toContain(token)
    }
  })

  it('leaves the fieldset carrying NO panel styling', () => {
    // ⚠️ THE NEGATIVE GUARD, and it strips nothing on purpose: these are checked
    // as exact TOKENS, so a `sm:p-4` or `md:surface-inset` regression is caught
    // too rather than slipping past a bare substring test (story 42.3's review).
    const { fieldset } = renderPlanner()
    const fieldsetTokens = tokens(fieldset)
    for (const banned of ['p-4', 'surface-inset', 'rounded-lg']) {
      expect(fieldsetTokens).not.toContain(banned)
      // Strip BOTH variants and Tailwind's important markers before comparing.
      // ⚠️ Review found the first version caught `sm:p-4` but sailed past
      // `!p-4`, `sm:!p-4` and `p-4!` — each of which re-creates the exact defect.
      expect(fieldsetTokens.map(baseClass).includes(banned)).toBe(false)
    }
  })

  it('keeps the legend out of rendered-legend layout across browsers', () => {
    // ⚠️ CLAIM CORRECTED IN REVIEW. This used to say "without this token the fix
    // is inert" — measured false: dropping `float-left` leaves every e2e
    // geometry assertion green, because with a transparent, unpadded fieldset a
    // rendered legend lands in the same place an ordinary block would. The
    // panel-styling move is what fixes the defect.
    //
    // The tokens stay as cross-browser insurance — per spec a first-child
    // `<legend>` is the rendered legend unless floated or positioned, and the
    // Playwright matrix is Chromium-only — so this is the pin that keeps them,
    // and it is honest about being a convention pin rather than a defect guard.
    const { legend } = renderPlanner()
    expect(tokens(legend)).toContain('float-left')
    expect(tokens(legend)).toContain('w-full')
  })
})

describe('the radio options are untouched (AC-5)', () => {
  it('keeps both options, their 44px targets and their focus rings', () => {
    const { panel } = renderPlanner()
    const labels = panel.querySelectorAll('label')
    expect(labels).toHaveLength(2)
    for (const label of labels) {
      expect(tokens(label)).toContain('min-h-[44px]')
    }
    const radios = panel.querySelectorAll('input[type="radio"]')
    expect(radios).toHaveLength(2)
    for (const radio of radios) {
      expect(tokens(radio)).toContain('focus:ring-2')
    }
  })

  it('keeps the selected/unselected border treatment', () => {
    const { panel } = renderPlanner()
    const [selected, unselected] = [...panel.querySelectorAll('label')]
    // Deplete is the default model.
    expect(tokens(selected as Element)).toContain('border-blue-500')
    expect(tokens(unselected as Element)).toContain('border-gray-300')
  })

  it('still renders both models by name', () => {
    renderPlanner()
    expect(screen.getByRole('radio', { name: /Deplete by life expectancy/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Perpetual safe-withdrawal/ })).toBeInTheDocument()
  })
})
