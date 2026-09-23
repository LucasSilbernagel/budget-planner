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
 * ⚠️ NOT COVERED BY E2E, DELIBERATELY. MEASURED 2026-09-23 on the `chromium-paid`
 * server (:5174): `await getProfiles(request)` THROWS
 * `ReferenceError: Buffer is not defined` inside its dynamic import — Vite bundles
 * the `pg` driver into the client in dev — so the request never reaches the server
 * and no `ApiResult` is ever produced. `/forecasting` therefore lands on the `error`
 * arm in e2e whatever the account holds, and an e2e written for the no-profile arm
 * would be a green test measuring a dev-only bundling artifact. See story §1 D4.
 */

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

const getProfiles = vi.fn()
const getForecastingProfiles = vi.fn()
const createForecastingProfile = vi.fn()

vi.mock('../../server/functions/profiles', () => ({
  getProfiles: (...args: unknown[]) => getProfiles(...args),
}))

vi.mock('../../server/functions/forecastingProfiles', () => ({
  getForecastingProfiles: (...args: unknown[]) => getForecastingProfiles(...args),
  createForecastingProfile: (...args: unknown[]) => createForecastingProfile(...args),
  deleteForecastingProfile: vi.fn(async () => ({ success: true, data: null })),
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
  getProfiles.mockResolvedValue({ success: true, data: [aProfile()] })
  getForecastingProfiles.mockResolvedValue({ success: true, data: [] })
  createForecastingProfile.mockResolvedValue({ success: true, data: { id: 1 } })
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
    getProfiles.mockResolvedValue({ success: true, data: [] })
    renderWithRouter(<ForecastingPage />)

    const notice = await screen.findByTestId('save-blocked-notice')
    expect(notice).toHaveTextContent(NO_PROFILE_NOTICE)
    expect(screen.getByRole('link', { name: /create a profile/i })).toHaveAttribute(
      'href',
      '/profiles'
    )
  })

  it('says nothing of the sort once a profile exists', async () => {
    getProfiles.mockResolvedValue({ success: true, data: [aProfile()] })
    renderWithRouter(<ForecastingPage />)

    // Positive control: the page really rendered the builder. Without it a
    // `queryBy… toBeNull()` pair passes just as happily on a blank render.
    await findSaveButton()
    await waitFor(() => expect(getProfiles).toHaveBeenCalled())

    expect(screen.queryByTestId('save-blocked-notice')).toBeNull()

    // ⚠️ Absence alone cannot tell `ready` from `loading` — both render no notice
    // and an enabled button, so a `ready` branch that never set state would pass
    // (code review 62.2). Driving a save to success proves the arm RESOLVED and
    // carried a usable profile id.
    fireEvent.click(screen.getByRole('button', { name: /save forecast/i }))
    expect(await screen.findByTestId('save-success')).toBeInTheDocument()
    expect(createForecastingProfile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ profileId: 'prof-1' })
    )
  })

  it('keeps a resolved profile when the SAVED-FORECAST LIST fetch fails', async () => {
    // ⚠️⚠️ REGRESSION GUARD (code review 62.2). The mount effect's single `try`
    // wraps both fetches, so an unconditional `{kind:'error'}` in its `catch` let a
    // failure of the forecast LIST demote an already-resolved `ready` — disabling
    // Save and claiming the PROFILE check had failed, for a save that worked at
    // `581c3f8`.
    getProfiles.mockResolvedValue({ success: true, data: [aProfile()] })
    getForecastingProfiles.mockRejectedValue(new Error('list fetch exploded'))
    renderWithRouter(<ForecastingPage />)

    const saveButton = await findSaveButton()
    await waitFor(() => expect(getForecastingProfiles).toHaveBeenCalled())

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
      getProfiles.mockResolvedValue({ success: true })
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
    getProfiles.mockResolvedValue({ success: true, data: [{ id: '', isDefault: true }] })
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
    createForecastingProfile.mockReturnValue(
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
    getProfiles.mockReturnValue(new Promise(() => {}))
    renderWithRouter(<ForecastingPage />)

    await findSaveButton()
    expect(screen.queryByTestId('save-blocked-notice')).toBeNull()
  })

  it('does not tell a user whose profile check FAILED to create a profile (AC-2)', async () => {
    getProfiles.mockResolvedValue({ success: false, error: 'Authentication required' })
    renderWithRouter(<ForecastingPage />)

    const notice = await screen.findByTestId('save-blocked-notice')
    expect(notice).toHaveTextContent(PROFILE_ERROR_NOTICE)
    expect(screen.queryByRole('link', { name: /create a profile/i })).toBeNull()
  })

  it('treats a THROWN profile fetch as an error, not as "you have no profiles" (AC-2)', async () => {
    getProfiles.mockRejectedValue(new Error('Buffer is not defined'))
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
    createForecastingProfile.mockResolvedValue({ success: false, error: 'Name already in use' })
    renderWithRouter(<ForecastingPage />)
    fireEvent.click(await findSaveButton())

    expect(await screen.findByTestId('save-outcome')).toHaveTextContent('Name already in use')
    expect(screen.queryByTestId('save-success')).toBeNull()
  })

  it('surfaces a THROWN save (network failure) at the button', async () => {
    createForecastingProfile.mockRejectedValue(new Error('Failed to fetch'))
    renderWithRouter(<ForecastingPage />)
    fireEvent.click(await findSaveButton())

    expect(await screen.findByTestId('save-outcome')).toHaveTextContent('Failed to fetch')
  })

  it('does not attempt a save at all when there is no profile to save to', async () => {
    getProfiles.mockResolvedValue({ success: true, data: [] })
    renderWithRouter(<ForecastingPage />)

    const saveButton = await findSaveButton()
    await waitFor(() => expect(saveButton).toBeDisabled())
    fireEvent.click(saveButton)

    expect(createForecastingProfile).not.toHaveBeenCalled()
  })
})
