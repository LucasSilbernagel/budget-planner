import { renderWithRouter, screen } from '@/test/utils'
import { fireEvent, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { Route } from '../forecasting'

/**
 * Saving a forecast reports its outcome where the user is looking (story 62.2, FR95).
 *
 * ⚠️⚠️ The defect this pins: `defaultProfileId` was a bare `string | null`, and
 * `null` meant FIVE different things — effect not yet run, zero profiles, session
 * expired, premium denied at the server boundary, or a thrown fetch. The route now
 * carries an explicit four-arm status, and the "create a profile" prompt renders for
 * exactly one of them.
 *
 * ⚠️ The transport (`lib/forecasting/forecast-api.ts`) is mocked with the same
 * `ApiResult` shapes the routes answer. That the page and the REAL routes agree is
 * proven in `forecasting-transport-chain.db.test.tsx` (story 83.1), and the save
 * round trip on the production build in `e2e/forecasting-roundtrip.prod.spec.ts`.
 * The profile ARMS stay unit-tested here: the paid dev e2e server (:5174) has no
 * real session, so `/api/profiles` answers 401 there and every account lands on the
 * `error` arm. (Until story 83.1 it landed there because the page's client-side
 * server import threw `ReferenceError: Buffer is not defined`, story 80.1 Fact R.)
 */

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

const fetchProfiles = vi.fn()
const fetchForecasts = vi.fn()
const saveForecast = vi.fn()

vi.mock('../../lib/forecasting/forecast-api', () => ({
  fetchProfiles: (...args: unknown[]) => fetchProfiles(...args),
  fetchForecasts: (...args: unknown[]) => fetchForecasts(...args),
  saveForecast: (...args: unknown[]) => saveForecast(...args),
  deleteForecast: vi.fn(async () => ({ success: true })),
}))

const ForecastingPage = Route.options.component as () => React.ReactElement

const ISO = '2026-09-23T00:00:00.000Z'
const PROFILE = 'profile-test'

/** The copy under test, pinned so a reword fails loudly instead of silently. */
const NO_PROFILE_NOTICE =
  'Saving a forecast needs a financial profile, and this account does not have one yet.'
const PROFILE_ERROR_NOTICE =
  'We could not check your financial profiles, so saving is unavailable right now.'

function aProfile(): Record<string, unknown> {
  return { id: 'prof-1', name: 'Household', isDefault: true }
}

function mockPaidUser(): void {
  const status: PremiumAccessStatus = {
    hasAccess: true,
    subscriptionStatus: 'active',
    isLoading: false,
    error: null,
    isAuthenticated: true,
  }
  usePremiumAccess.mockReturnValue({ status })
}

/** Enough of the user's own money that the builder computes a result to save. */
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

async function findSaveButton(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
}

beforeEach(() => {
  mockPaidUser()
  seedOwnFinances()
  fetchProfiles.mockResolvedValue({ success: true, data: [aProfile()] })
  fetchForecasts.mockResolvedValue({ success: true, data: [] })
  saveForecast.mockResolvedValue({ success: true, data: { id: 1 } })
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
  vi.clearAllMocks()
})

describe('an account with no financial profile is told BEFORE it builds anything (AC-1, AC-8)', () => {
  it('explains the missing profile and links to /profiles', async () => {
    fetchProfiles.mockResolvedValue({ success: true, data: [] })
    renderWithRouter(<ForecastingPage />)

    const notice = await screen.findByTestId('save-blocked-notice')
    expect(notice).toHaveTextContent(NO_PROFILE_NOTICE)
    expect(screen.getByRole('link', { name: /create a profile/i })).toHaveAttribute(
      'href',
      '/profiles'
    )
  })

  it('says nothing of the sort once a profile exists', async () => {
    fetchProfiles.mockResolvedValue({ success: true, data: [aProfile()] })
    renderWithRouter(<ForecastingPage />)

    // Positive control: the page really rendered the builder. Without it a
    // `queryBy… toBeNull()` pair passes just as happily on a blank render.
    await findSaveButton()
    await waitFor(() => expect(fetchProfiles).toHaveBeenCalled())

    expect(screen.queryByTestId('save-blocked-notice')).toBeNull()

    // ⚠️ Absence alone cannot tell `ready` from `loading` — both render no notice
    // and an enabled button, so a `ready` branch that never set state would pass
    // (code review 62.2). Driving a save to success proves the arm RESOLVED and
    // carried a usable profile id.
    fireEvent.click(screen.getByRole('button', { name: /save forecast/i }))
    expect(await screen.findByTestId('save-success')).toBeInTheDocument()
    expect(saveForecast).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'prof-1' }))
  })

  it('keeps a resolved profile when the SAVED-FORECAST LIST fetch fails', async () => {
    // ⚠️⚠️ REGRESSION GUARD (code review 62.2). The mount effect's single `try`
    // wraps both fetches, so an unconditional `{kind:'error'}` in its `catch` let a
    // failure of the forecast LIST demote an already-resolved `ready` — disabling
    // Save and claiming the PROFILE check had failed, for a save that worked at
    // `581c3f8`.
    fetchProfiles.mockResolvedValue({ success: true, data: [aProfile()] })
    fetchForecasts.mockRejectedValue(new Error('list fetch exploded'))
    renderWithRouter(<ForecastingPage />)

    const saveButton = await findSaveButton()
    await waitFor(() => expect(fetchForecasts).toHaveBeenCalled())

    expect(screen.queryByTestId('save-blocked-notice')).toBeNull()
    expect(saveButton).not.toBeDisabled()
  })

  it('treats a malformed success (no data array) as an error, not as "no profiles"', async () => {
    // ⚠️⚠️ MEASURED VACUOUS on its first draft (code review 62.2 follow-up). With
    // the `!Array.isArray` branch disabled, `data.length` THROWS on undefined and
    // the catch produces the very same notice — so asserting the copy alone passed
    // against the defect. The `console.error` assertion is what separates
    // "classified deliberately" from "crashed and was caught": only the catch logs.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      fetchProfiles.mockResolvedValue({ success: true })
      renderWithRouter(<ForecastingPage />)

      expect(await screen.findByTestId('save-blocked-notice')).toHaveTextContent(
        PROFILE_ERROR_NOTICE
      )
      expect(screen.queryByRole('link', { name: /create a profile/i })).toBeNull()
      expect(consoleError).not.toHaveBeenCalledWith(
        'Failed to load forecasting data:',
        expect.anything()
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('treats a profile carrying an empty id as an error, not as ready', async () => {
    // `{kind:'ready', profileId:''}` derives a FALSY `defaultProfileId`, so the arm
    // claiming success would emit the old one-message-for-everything save error.
    fetchProfiles.mockResolvedValue({ success: true, data: [{ id: '', isDefault: true }] })
    renderWithRouter(<ForecastingPage />)

    expect(await screen.findByTestId('save-blocked-notice')).toHaveTextContent(PROFILE_ERROR_NOTICE)
  })

  it('locks the tab strip while a save is in flight, and releases it afterwards', async () => {
    // ⚠️ Switching tabs CSS-hides the builder, where the failure alert lives —
    // hidden, it is neither focusable nor announced, so a failed save reached
    // nobody. The release half matters just as much: a latched lock would leave
    // the user unable to navigate at all.
    // ⚠️ A deferred promise holds the save IN FLIGHT so the LOCK itself is
    // observable. Asserting only the release (as the first draft of this test did)
    // passes just as happily against a build where the tabs are never locked.
    let release: (v: { success: boolean; error?: string }) => void = () => {}
    saveForecast.mockReturnValue(
      new Promise<{ success: boolean; error?: string }>((resolve) => {
        release = resolve
      })
    )
    renderWithRouter(<ForecastingPage />)

    const saveButton = await findSaveButton()
    const projectionsTab = screen.getByRole('button', { name: /projections/i })
    expect(projectionsTab).not.toBeDisabled()

    fireEvent.click(saveButton)

    await waitFor(() => expect(projectionsTab).toBeDisabled())

    release({ success: false, error: 'Name already in use' })

    await screen.findByTestId('save-outcome')
    await waitFor(() => expect(projectionsTab).not.toBeDisabled())
  })

  it('does not flash the prompt while the profile check is still in flight (AC-2)', async () => {
    // Never resolves: the component stays on the `loading` arm for the whole test.
    fetchProfiles.mockReturnValue(new Promise(() => {}))
    renderWithRouter(<ForecastingPage />)

    await findSaveButton()
    expect(screen.queryByTestId('save-blocked-notice')).toBeNull()
  })

  it('does not tell a user whose profile check FAILED to create a profile (AC-2)', async () => {
    fetchProfiles.mockResolvedValue({ success: false, error: 'Authentication required' })
    renderWithRouter(<ForecastingPage />)

    const notice = await screen.findByTestId('save-blocked-notice')
    expect(notice).toHaveTextContent(PROFILE_ERROR_NOTICE)
    expect(screen.queryByRole('link', { name: /create a profile/i })).toBeNull()
  })

  it('treats a THROWN profile fetch as an error, not as "you have no profiles" (AC-2)', async () => {
    // A network failure: `fetch` rejects (until story 83.1 the real-world throw
    // was the client-side server import's `Buffer is not defined`).
    fetchProfiles.mockRejectedValue(new TypeError('Failed to fetch'))
    renderWithRouter(<ForecastingPage />)

    const notice = await screen.findByTestId('save-blocked-notice')
    expect(notice).toHaveTextContent(PROFILE_ERROR_NOTICE)
    expect(screen.queryByRole('link', { name: /create a profile/i })).toBeNull()
  })
})

describe('a save reports its outcome where the user is looking (AC-5, AC-7)', () => {
  it('confirms a successful save OUTSIDE the builder, which the tab switch hides', async () => {
    renderWithRouter(<ForecastingPage />)
    fireEvent.click(await findSaveButton())

    const confirmation = await screen.findByTestId('save-success')
    expect(confirmation).toHaveTextContent(/My Financial Forecast/)
    expect(confirmation).toHaveAttribute('role', 'status')

    // ⚠️ The builder is CSS-hidden (never unmounted) once the page switches to the
    // "saved" tab, so a confirmation rendered inside it would still be findable in
    // jsdom while being invisible to every real user. Assert it is NOT in there.
    const builderPanel = screen
      .getByRole('heading', { name: 'Scenario Builder' })
      .closest('.hidden')
    expect(builderPanel).not.toBeNull()
    expect(builderPanel).not.toContainElement(confirmation)
  })

  it('surfaces a rejected save (duplicate name) at the button', async () => {
    saveForecast.mockResolvedValue({ success: false, error: 'Name already in use' })
    renderWithRouter(<ForecastingPage />)
    fireEvent.click(await findSaveButton())

    expect(await screen.findByTestId('save-outcome')).toHaveTextContent('Name already in use')
    expect(screen.queryByTestId('save-success')).toBeNull()
  })

  it('surfaces a THROWN save (network failure) at the button', async () => {
    saveForecast.mockRejectedValue(new Error('Failed to fetch'))
    renderWithRouter(<ForecastingPage />)
    fireEvent.click(await findSaveButton())

    expect(await screen.findByTestId('save-outcome')).toHaveTextContent('Failed to fetch')
  })

  it('does not attempt a save at all when there is no profile to save to', async () => {
    fetchProfiles.mockResolvedValue({ success: true, data: [] })
    renderWithRouter(<ForecastingPage />)

    const saveButton = await findSaveButton()
    await waitFor(() => expect(saveButton).toBeDisabled())
    fireEvent.click(saveButton)

    expect(saveForecast).not.toHaveBeenCalled()
  })
})
