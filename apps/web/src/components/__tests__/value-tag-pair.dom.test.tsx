import { renderWithProviders } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { SavingsPage } from '../SavingsPage'
import {
  RESPONSIVE_AMOUNT_CLASS,
  RESPONSIVE_STACKED_CELL_CLASS,
  RESPONSIVE_TAG_CLASS,
  RESPONSIVE_VALUE_TAG_CLASS,
} from '../ui/ResponsiveTable'

/**
 * Value/tag pairs on the rendered Savings table (story 42.3, UX-DR47).
 *
 * ⚠️ EVERY pair is checked by ITERATION, never `[0]`. Story 42.2's review found
 * exactly that hole one story ago — a `getAllByRole('region')[0]` guard that
 * would let a second pair ship unwired. Savings renders TWO pairs per row (name
 * + Account/Goal badge, allocation + Auto/Fixed pill) and a forgotten one fails
 * SILENTLY: the cell renders, it just breaks apart at 320px, and nothing else
 * notices.
 *
 * ⚠️ Structural only. jsdom computes no layout and applies no media queries, so
 * nothing here proves a line count, a width, or that anything stays on one
 * line. Those are geometry claims: `e2e/value-tag-one-line.spec.ts` made them
 * until stories 84.2/84.5 deleted it, and the CI screenshot `savings-320-light`
 * is the only layout guard on these pairs now (story 91.1). Read a case below
 * as "this page declares what the AC needs".
 */

const premiumTier = vi.hoisted(() => ({
  status: {
    hasAccess: false,
    subscriptionStatus: 'free',
    isLoading: false,
    error: null,
    isAuthenticated: true,
  } as PremiumAccessStatus,
}))

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => ({ status: premiumTier.status }),
}))

function seedSavings(): void {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
  // A goal (has a target) and an account (no target) — the two badge branches.
  useSavingsStore.getState().addSavingsGoal({
    name: 'Alpha',
    targetAmount: 900_00,
    currentBalance: 300_00,
  })
  useSavingsStore.getState().addSavingsGoal({
    name: 'Emergency Fund',
    targetAmount: null,
    currentBalance: 500_00,
  })
  vi.useRealTimers()
}

beforeEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useCategoryStore.setState({ categories: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
  localStorage.clear()
  seedSavings()
})

afterEach(() => {
  useSavingsStore.setState({ savingsGoals: [] })
})

const tokens = (value: string | null | undefined): string[] =>
  (value ?? '').split(/\s+/).filter(Boolean)

/** Class tokens with variant prefixes removed, so a negative assertion cannot be
 * evaded by shipping the same utility under `max-sm:`. Bracket-aware: a greedy
 * strip would mangle `[padding-left:1rem]`. */
const bareUtilities = (list: string[]): string[] =>
  list.map((token) => {
    const bracket = token.indexOf('[')
    const head = bracket === -1 ? token : token.slice(0, bracket)
    const stripped = head.replace(/^(?:[a-z][a-z0-9-]*:)+/, '')
    return bracket === -1 ? stripped : stripped + token.slice(bracket)
  })

/**
 * ⚠️ THE GUARD THAT MAKES THE LOOPS BELOW NON-VACUOUS, AND IT IS NOT THEORETICAL.
 *
 * Every case here loops `for (const token of tokens(SOME_CONSTANT))`. If the
 * constant is ever empty — or `undefined`, which is what an import resolves to
 * once someone deletes the export — that loop body runs ZERO times and the case
 * passes while asserting nothing.
 *
 * Caught by running the story's own positive control: with the production fix
 * stashed, `ResponsiveTable.test.tsx` correctly reddened on the missing
 * constants while THIS file reported 3/3 green. A guard that survives the
 * deletion of the thing it guards is worse than no guard — it reports safety
 * that is not there. Assert the expectation set is non-empty first.
 */
function expectedTokens(name: string, value: string | undefined): string[] {
  const list = tokens(value)
  expect(
    list.length,
    `${name} resolved to no class tokens — this suite would assert nothing`
  ).toBeGreaterThan(0)
  return list
}

describe('value/tag pairs on the Savings table', () => {
  it('EVERY allocation cell carries a protected tag and a group-wrapping amount, stacked (AC-1, 91.1)', () => {
    const { container } = renderWithProviders(<SavingsPage />)

    const amounts = [...container.querySelectorAll('[data-testid^="savings-allocation-"]')].filter(
      (el) => !(el.getAttribute('data-testid') ?? '').startsWith('savings-allocation-mode-')
    )
    expect(amounts.length, 'the savings table rendered no allocation cells').toBeGreaterThan(0)

    for (const amount of amounts) {
      const id = amount.getAttribute('data-testid')
      // The amount is a currency figure: it wraps only between digit groups
      // (story 91.1 D3; nowrap until then).
      for (const token of expectedTokens('RESPONSIVE_AMOUNT_CLASS', RESPONSIVE_AMOUNT_CLASS)) {
        expect(tokens(amount.getAttribute('class')), `${id} is missing ${token}`).toContain(token)
      }
      expect(
        bareUtilities(tokens(amount.getAttribute('class'))),
        `${id}: the allocation figure is nowrap again (story 91.1 D3 moved it off nowrap)`
      ).not.toContain('whitespace-nowrap')
      // Stacked below `sm` (story 91.1): beside its label the figure + pill
      // overflowed the cell for an ordinary `$987.65` (measured, 320px).
      const cell = amount.closest('td')
      for (const token of expectedTokens(
        'RESPONSIVE_STACKED_CELL_CLASS',
        RESPONSIVE_STACKED_CELL_CLASS
      )) {
        expect(tokens(cell?.getAttribute('class')), `${id} cell is missing ${token}`).toContain(
          token
        )
      }

      const pair = amount.parentElement
      expect(pair, `${id} has no pair wrapper`).not.toBeNull()
      for (const token of expectedTokens(
        'RESPONSIVE_VALUE_TAG_CLASS',
        RESPONSIVE_VALUE_TAG_CLASS
      )) {
        expect(tokens(pair?.getAttribute('class')), `${id} pair is missing ${token}`).toContain(
          token
        )
      }

      // ⚠️ Story 72.1 (reverses 64.1 / FR98): ONE allocation-cell shape again.
      // Every row — goal or target-less account — carries a figure AND an
      // Auto/Fixed pill. 64.1 briefly gave accounts a dash with no pill; that
      // branch is gone, so every row owes the pill's tokens.
      //
      // ⚠️ Still classified from the STORE, never from the rendered text: the id
      // must match a seeded row, and the seed deliberately holds one of each kind
      // (asserted), so an account row cannot quietly drop out of this loop.
      const rowId = (id ?? '').replace('savings-allocation-', '')
      const seeded = useSavingsStore.getState().savingsGoals.find((g) => g.id === rowId)
      expect(seeded, `${id} matches no seeded savings row`).toBeDefined()
      const tag = pair?.querySelector('[data-testid^="savings-allocation-mode-"]')
      expect(tag, `${id} has no Auto/Fixed tag`).not.toBeNull()
      for (const token of expectedTokens('RESPONSIVE_TAG_CLASS', RESPONSIVE_TAG_CLASS)) {
        expect(tokens(tag?.getAttribute('class')), `${id} tag is missing ${token}`).toContain(token)
      }
    }
    // Both kinds were actually checked above: the seed holds one goal and one
    // target-less account, and the loop visited a cell for EXACTLY the seeded
    // rows — compared by id, not by count.
    const seededRows = useSavingsStore.getState().savingsGoals
    expect(seededRows.map((g) => (g.targetAmount == null ? 'account' : 'goal')).sort()).toEqual([
      'account',
      'goal',
    ])
    const visitedIds = amounts
      .map((el) => (el.getAttribute('data-testid') ?? '').replace('savings-allocation-', ''))
      .sort()
    expect(visitedIds).toEqual(seededRows.map((g) => g.id).sort())
  })

  it('EVERY name cell protects its badge but leaves the name wrappable (AC-2)', () => {
    const { container } = renderWithProviders(<SavingsPage />)

    const badges = [...container.querySelectorAll('[data-testid^="savings-badge-"]')]
    expect(badges.length, 'the savings table rendered no name badges').toBeGreaterThan(0)

    for (const badge of badges) {
      const id = badge.getAttribute('data-testid')
      for (const token of expectedTokens('RESPONSIVE_TAG_CLASS', RESPONSIVE_TAG_CLASS)) {
        expect(tokens(badge.getAttribute('class')), `${id} is missing ${token}`).toContain(token)
      }

      const pair = badge.parentElement
      for (const token of expectedTokens(
        'RESPONSIVE_VALUE_TAG_CLASS',
        RESPONSIVE_VALUE_TAG_CLASS
      )) {
        expect(tokens(pair?.getAttribute('class')), `${id} pair is missing ${token}`).toContain(
          token
        )
      }

      // ⚠️ THE POINT OF THIS CASE. The name is unbounded user free text, so it
      // must stay wrappable — `whitespace-nowrap` on it is the ~1134px revert
      // that `ResponsiveTable.tsx` forbids. Protect the tag, never the value.
      const name = pair?.firstElementChild
      expect(name, `${id} pair has no name element`).not.toBeNull()
      // ⚠️ Variant-stripped. `max-sm:whitespace-nowrap` is the MOST plausible bad
      // edit — max-sm is the regime the defect lives in — and an exact-token
      // check would wave it through while this message promised to catch it.
      expect(
        bareUtilities(tokens(name?.getAttribute('class'))),
        `${id}: the NAME carries whitespace-nowrap (in some variant). That reverts the 320px card layout — only the badge may be protected.`
      ).not.toContain('whitespace-nowrap')
      // ⚠️ Nor the figure's `overflow-wrap: normal` (story 91.1): the name must
      // keep the cell's inherited `anywhere`, or a long unbroken name becomes
      // one unbreakable run again.
      expect(
        bareUtilities(tokens(name?.getAttribute('class'))),
        `${id}: the NAME carries the amount class; free text must keep wrapping anywhere`
      ).not.toContain('[overflow-wrap:normal]')

      // Stacked below `sm` (story 91.1): beside its label, `Emergency Fund`
      // broke as `Emergenc` / `y Fund` next to its badge (measured, 320px).
      const cell = badge.closest('td')
      for (const token of expectedTokens(
        'RESPONSIVE_STACKED_CELL_CLASS',
        RESPONSIVE_STACKED_CELL_CLASS
      )) {
        expect(tokens(cell?.getAttribute('class')), `${id} cell is missing ${token}`).toContain(
          token
        )
      }
    }
  })

  it('only the TAGS are nowrap: never the name, and never the figure (since 91.1)', () => {
    // A single regression would be to "tidy" the call sites into one that
    // applies the nowrap class to everything. That reads as consistency and
    // silently reverts the wrapping contract on the name (and, since story
    // 91.1, lets a figure overflow its cell instead of wrapping at a group).
    const { container } = renderWithProviders(<SavingsPage />)
    const nowrapped = [...container.querySelectorAll('td span')].filter((el) =>
      bareUtilities(tokens(el.getAttribute('class'))).includes('whitespace-nowrap')
    )
    // ⚠️ This file's own docblock mandates a non-emptiness guard before any
    // `for…of` assertion loop, and this case shipped without one — caught in
    // code review, one test after the doctrine was written.
    //
    // The arithmetic, restated for Story 91.1: the two seeded rows are one GOAL
    // and one target-less ACCOUNT, and both are allocated. Each gives 1 Auto/Fixed
    // pill + 1 badge, so 2 × 2 = 4 protected elements. (72.1 had 6: the amount
    // was nowrap too until 91.1 D3.) The floor is stated as the exact expected
    // count so that LOSING a protected element still fails here.
    expect(
      nowrapped.length,
      'no element carries whitespace-nowrap — this case would assert nothing'
    ).toBe(4)
    for (const el of nowrapped) {
      const testId = el.getAttribute('data-testid') ?? ''
      const isTag =
        testId.startsWith('savings-allocation-mode-') || testId.startsWith('savings-badge-')
      expect(
        isTag,
        `an unexpected element carries whitespace-nowrap: ${testId || el.textContent}`
      ).toBe(true)
    }
  })
})
