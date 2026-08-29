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
  RESPONSIVE_TAG_CLASS,
  RESPONSIVE_VALUE_NOWRAP_CLASS,
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
 * line. Those are geometry claims and `e2e/value-tag-one-line.spec.ts` makes
 * them against real pixels under the CI font. Read a case below as "this page
 * declares what the AC needs".
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
  it('EVERY allocation cell carries a protected tag and a nowrap amount (AC-1)', () => {
    const { container } = renderWithProviders(<SavingsPage />)

    const amounts = [...container.querySelectorAll('[data-testid^="savings-allocation-"]')].filter(
      (el) => !(el.getAttribute('data-testid') ?? '').startsWith('savings-allocation-mode-')
    )
    expect(amounts.length, 'the savings table rendered no allocation cells').toBeGreaterThan(0)

    for (const amount of amounts) {
      const id = amount.getAttribute('data-testid')
      // The amount is a BOUNDED currency figure, so it may be nowrap.
      for (const token of expectedTokens(
        'RESPONSIVE_VALUE_NOWRAP_CLASS',
        RESPONSIVE_VALUE_NOWRAP_CLASS
      )) {
        expect(tokens(amount.getAttribute('class')), `${id} is missing ${token}`).toContain(token)
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

      const tag = pair?.querySelector('[data-testid^="savings-allocation-mode-"]')
      expect(tag, `${id} has no Auto/Fixed tag`).not.toBeNull()
      for (const token of expectedTokens('RESPONSIVE_TAG_CLASS', RESPONSIVE_TAG_CLASS)) {
        expect(tokens(tag?.getAttribute('class')), `${id} tag is missing ${token}`).toContain(token)
      }
    }
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
    }
  })

  it('the two pair kinds are distinguishable: only the bounded value is nowrap', () => {
    // A single regression would be to "tidy" the two call sites into one that
    // applies the nowrap class to both. That reads as consistency and silently
    // reverts the wrapping contract on the name.
    const { container } = renderWithProviders(<SavingsPage />)
    const nowrapped = [...container.querySelectorAll('td span')].filter((el) =>
      bareUtilities(tokens(el.getAttribute('class'))).includes('whitespace-nowrap')
    )
    // ⚠️ This file's own docblock mandates a non-emptiness guard before any
    // `for…of` assertion loop, and this case shipped without one — caught in
    // code review, one test after the doctrine was written. Two seeded rows
    // give 2 amounts + 2 pills + 2 badges = 6 protected elements.
    expect(
      nowrapped.length,
      'no element carries whitespace-nowrap — this case would assert nothing'
    ).toBeGreaterThanOrEqual(6)
    for (const el of nowrapped) {
      const testId = el.getAttribute('data-testid') ?? ''
      const isTag =
        testId.startsWith('savings-allocation-mode-') || testId.startsWith('savings-badge-')
      const isBoundedValue = testId.startsWith('savings-allocation-') && !isTag
      expect(
        isTag || isBoundedValue,
        `an unexpected element carries whitespace-nowrap: ${testId || el.textContent}`
      ).toBe(true)
    }
  })
})
