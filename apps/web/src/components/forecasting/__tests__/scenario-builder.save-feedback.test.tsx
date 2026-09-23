import { renderWithRouter, screen } from '@/test/utils'
import { fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ScenarioBuilder } from '../scenario-builder'

/**
 * Where a save reports itself (story 62.2, FR95).
 *
 * ⚠️ These use `renderWithRouter`, not the bare `render` the sibling
 * `scenario-builder.test.tsx` uses, because the blocked-save notice contains a
 * `<Link to="/profiles">` and TanStack's Link needs a router in context. The
 * sibling suites keep working on bare `render` only because they omit
 * `saveAvailability`, whose default arm renders no Link — if that default ever
 * changes, ~40 tests in two files start failing on a missing router, which will
 * look like anything except the real cause.
 *
 * ⚠️ Real timers throughout. The Save button appears only after the 500 ms
 * debounced recompute, so every save path goes through
 * `findByRole(..., { timeout })` exactly as the sibling suite does.
 */

const mockCurrency = vi.hoisted(() => ({
  mode: 'none' as 'none' | 'symbol',
  currency: 'NONE',
  locale: 'en-US',
}))

vi.mock('../../../stores/currencyStore', () => ({
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
  useCurrencyPreferences: () => ({ ...mockCurrency }),
  useCurrencyMode: () => mockCurrency.mode,
  useCurrencyCode: () => mockCurrency.currency,
}))

const ISO = '2026-09-23T00:00:00.000Z'
const PROFILE = 'profile-test'

/** Enough of the user's own money for the builder to compute a result to save. */
function seedOwnFinances(): void {
  useProfileStore.setState({ activeProfileId: PROFILE })
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        profileId: PROFILE,
        userId: 0,
        name: 'Salary',
        amount: 500_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
}

/** The copy under test, pinned so a reword fails loudly instead of silently. */
const NO_PROFILE_NOTICE =
  'Saving a forecast needs a financial profile, and this account does not have one yet.'
const PROFILE_ERROR_NOTICE =
  'We could not check your financial profiles, so saving is unavailable right now.'
const NO_PROFILE_SHORT = 'Needs a financial profile'
const PROFILE_ERROR_SHORT = 'Profile check failed'

async function findSaveButton(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
}

beforeEach(() => {
  mockCurrency.mode = 'none'
  mockCurrency.currency = 'NONE'
  mockCurrency.locale = 'en-US'
  seedOwnFinances()
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
  vi.clearAllMocks()
})

describe('a failed save reports itself at the button (AC-3, AC-4)', () => {
  it('renders the outcome in the same block as the Save button, not only at the top of the form', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Name already in use' })
    renderWithRouter(<ScenarioBuilder onSave={onSave} />)

    const saveButton = await findSaveButton()
    // Positive control: nothing is announced before the save is attempted, so a
    // green assertion below cannot come from a node that was always present.
    expect(screen.queryByTestId('save-outcome')).toBeNull()

    fireEvent.click(saveButton)

    const outcome = await screen.findByTestId('save-outcome')
    expect(outcome).toHaveTextContent('Name already in use')
    // ⚠️ ORDER, not just containment (code review 62.2). The previous form of this
    // assertion was `outcome.parentElement` + `toContainElement(saveButton)` — a
    // DESCENDANT check that stayed green with the outcome moved to the top of the
    // results section or to the form root, i.e. against the exact defect it
    // claimed to pin. `DOCUMENT_POSITION_FOLLOWING` requires the button to come
    // AFTER the message, which is what makes "one Tab returns you to Save" true.
    expect(outcome.parentElement).toContainElement(saveButton)
    // `compareDocumentPosition` returns a bitmask; `&` is how it is read.
    const buttonFollowsMessage = Boolean(
      outcome.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(buttonFollowsMessage).toBe(true)
  })

  it('re-announces and re-focuses when a RETRY fails with the IDENTICAL message', async () => {
    // ⚠️ The regression this pins: `setSaveOutcome(<same string>)` is an
    // `Object.is` bail-out, so without a clear-before-attempt the alert node is
    // reused, nothing re-mounts, and neither the announcement nor the focus effect
    // fires. Measured twice in code review 62.2 as `sameNode=true activeTag=BUTTON`.
    const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Name already in use' })
    renderWithRouter(<ScenarioBuilder onSave={onSave} />)

    const saveButton = await findSaveButton()
    fireEvent.click(saveButton)
    const first = await screen.findByTestId('save-outcome')
    await waitFor(() => expect(document.activeElement).toBe(first))

    // Move focus off the alert, then retry with the SAME failure.
    saveButton.focus()
    expect(document.activeElement).toBe(saveButton)
    fireEvent.click(saveButton)

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    const second = await screen.findByTestId('save-outcome')
    // A genuine re-insertion: focus returns to the alert.
    await waitFor(() => expect(document.activeElement).toBe(second))
  })

  it('reports a REJECTED onSave, not only a resolved failure', async () => {
    // ⚠️ This test is why the builder's `catch (err)` arm exists. Before code
    // review 62.2 NO test made `onSave` reject — every failure drive resolved to
    // `{success:false}` — so the arm could be deleted with the suite still green,
    // while the story's record claimed this file drove it.
    const onSave = vi.fn().mockRejectedValue(new Error('Boom from the caller'))
    renderWithRouter(<ScenarioBuilder onSave={onSave} />)

    fireEvent.click(await findSaveButton())

    expect(await screen.findByTestId('save-outcome')).toHaveTextContent('Boom from the caller')
    // The button must recover, or a rejection strands the form in "Saving...".
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save forecast/i })).not.toBeDisabled()
    )
  })

  it('falls back to a generic message when a rejection carries an EMPTY message', async () => {
    // An empty string is falsy, so the alert would not render at all and the user
    // would see the button re-enable with no explanation.
    const onSave = vi.fn().mockRejectedValue(new Error(''))
    renderWithRouter(<ScenarioBuilder onSave={onSave} />)

    fireEvent.click(await findSaveButton())

    expect(await screen.findByTestId('save-outcome')).toHaveTextContent('Failed to save forecast')
  })

  it('reports the in-flight save upward so the page can lock its tabs', async () => {
    const onSavingChange = vi.fn()
    const onSave = vi.fn().mockRejectedValue(new Error('Boom'))
    renderWithRouter(<ScenarioBuilder onSave={onSave} onSavingChange={onSavingChange} />)

    fireEvent.click(await findSaveButton())
    await screen.findByTestId('save-outcome')

    // ⚠️ The FALSE arm is the one that matters: it runs in the same `finally` as
    // `setIsSaving(false)`, so a rejection cannot latch the page's tab lock and
    // leave the user unable to navigate.
    expect(onSavingChange).toHaveBeenCalledWith(true)
    expect(onSavingChange).toHaveBeenLastCalledWith(false)
  })

  it('retires a stale save outcome when the availability arm changes', async () => {
    // ⚠️ `renderWithRouter`'s `rerender` re-renders the ROUTER ROOT, not this
    // component, so the arm is flipped from inside a stateful wrapper instead.
    function Harness(): React.ReactElement {
      const [kind, setKind] = React.useState<'loading' | 'none'>('loading')
      return (
        <>
          <button type="button" onClick={() => setKind('none')}>
            resolve to none
          </button>
          <ScenarioBuilder
            onSave={vi.fn().mockResolvedValue({ success: false, error: 'Try again in a moment' })}
            saveAvailability={{ kind }}
          />
        </>
      )
    }
    renderWithRouter(<Harness />)

    const saveButton = await findSaveButton()
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)
    await screen.findByTestId('save-outcome')

    fireEvent.click(screen.getByRole('button', { name: /resolve to none/i }))

    // Otherwise the user reads "try again in a moment" beside a button that is
    // now permanently disabled.
    await waitFor(() => expect(screen.queryByTestId('save-outcome')).toBeNull())
    expect(screen.getByTestId('save-blocked-reason')).toBeInTheDocument()
  })

  it('announces the failure and moves focus onto it, leaving Save as the next tab stop', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Network unreachable' })
    renderWithRouter(<ScenarioBuilder onSave={onSave} />)

    const saveButton = await findSaveButton()
    fireEvent.click(saveButton)

    const outcome = await screen.findByTestId('save-outcome')
    expect(outcome).toHaveAttribute('role', 'alert')
    await waitFor(() => expect(document.activeElement).toBe(outcome))
    // Focusable at all — a `.focus()` on a non-focusable node is a silent no-op
    // that drops focus to <body> (CategoryManager.tsx:119-124).
    expect(outcome).toHaveAttribute('tabindex', '-1')
  })

  it('keeps the save outcome out of the calculation-error block (AC-9)', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Name already in use' })
    renderWithRouter(<ScenarioBuilder onSave={onSave} />)

    fireEvent.click(await findSaveButton())
    await screen.findByTestId('save-outcome')

    // The top block is for calculation failures. If the save error were still
    // parked in the shared `error` slot, this would find it there too.
    expect(screen.queryByTestId('calculation-error')).toBeNull()
  })

  it('clears the failure once the user edits a field to act on it (AC-9)', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Name already in use' })
    renderWithRouter(<ScenarioBuilder onSave={onSave} />)

    fireEvent.click(await findSaveButton())
    await screen.findByTestId('save-outcome')

    // The Scenario Name field, not a money field: this suite seeds income only, so
    // savings/investments both render '0.00' and a display-value lookup would be
    // ambiguous between them.
    fireEvent.change(screen.getByDisplayValue('My Financial Forecast'), {
      target: { value: 'Renamed forecast' },
    })

    await waitFor(() => expect(screen.queryByTestId('save-outcome')).toBeNull(), { timeout: 3000 })
  })
})

describe('the Save affordance explains itself when saving cannot work (AC-1, AC-2)', () => {
  it('names the missing profile and links to /profiles', async () => {
    renderWithRouter(<ScenarioBuilder onSave={vi.fn()} saveAvailability={{ kind: 'none' }} />)

    const notice = await screen.findByTestId('save-blocked-notice')
    expect(notice).toHaveTextContent(NO_PROFILE_NOTICE)
    expect(screen.getByRole('link', { name: /create a profile/i })).toHaveAttribute(
      'href',
      '/profiles'
    )
  })

  it('disables Save and says why beside it', async () => {
    renderWithRouter(<ScenarioBuilder onSave={vi.fn()} saveAvailability={{ kind: 'none' }} />)

    const saveButton = await findSaveButton()
    expect(saveButton).toBeDisabled()
    expect(screen.getByTestId('save-blocked-reason')).toHaveTextContent(NO_PROFILE_SHORT)
  })

  it('does NOT tell a user whose profile check failed to create a profile', async () => {
    renderWithRouter(<ScenarioBuilder onSave={vi.fn()} saveAvailability={{ kind: 'error' }} />)

    // Await the Save button first: the short reason renders beside it, inside the
    // results section, which only exists once the debounced forecast has computed.
    await findSaveButton()
    const notice = await screen.findByTestId('save-blocked-notice')
    expect(notice).toHaveTextContent(PROFILE_ERROR_NOTICE)
    // The wrong-copy defect: an account that HAS profiles must never be told to
    // go and make one because a fetch failed.
    expect(screen.queryByText(new RegExp(NO_PROFILE_NOTICE, 'i'))).toBeNull()
    expect(screen.queryByRole('link', { name: /create a profile/i })).toBeNull()
    expect(screen.getByTestId('save-blocked-reason')).toHaveTextContent(PROFILE_ERROR_SHORT)
  })

  it('shows nothing at all while the profile check is still in flight', async () => {
    renderWithRouter(<ScenarioBuilder onSave={vi.fn()} saveAvailability={{ kind: 'loading' }} />)

    // Positive control first: the builder really did render.
    const saveButton = await findSaveButton()
    expect(screen.queryByTestId('save-blocked-notice')).toBeNull()
    expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
    expect(saveButton).not.toBeDisabled()
  })

  it('refuses the save on a blocked arm even when the disabled attribute is bypassed', async () => {
    // ⚠️ The route-level sibling sits behind THREE guards (the `disabled`
    // attribute, this early return, and the page's `!defaultProfileId` check) and
    // stays green with any two deleted. This test re-enables the button first, so
    // it exercises the `saveBlockedReason` early return SPECIFICALLY — the "belt
    // to braces" guard that was otherwise never executed (code review 62.2).
    const onSave = vi.fn().mockResolvedValue({ success: true })
    renderWithRouter(<ScenarioBuilder onSave={onSave} saveAvailability={{ kind: 'none' }} />)

    const saveButton = (await findSaveButton()) as HTMLButtonElement
    expect(saveButton).toBeDisabled()
    saveButton.disabled = false
    fireEvent.click(saveButton)

    await waitFor(() => expect(screen.getByTestId('save-blocked-reason')).toBeInTheDocument())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('stays out of the way when the prop is omitted, so the sibling suites keep their meaning', async () => {
    renderWithRouter(<ScenarioBuilder onSave={vi.fn()} />)

    const saveButton = await findSaveButton()
    expect(screen.queryByTestId('save-blocked-notice')).toBeNull()
    expect(saveButton).not.toBeDisabled()
  })
})
