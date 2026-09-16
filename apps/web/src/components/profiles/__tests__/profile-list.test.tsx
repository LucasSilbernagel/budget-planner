import { useProfileStore } from '@/stores/profileStore'
import { fireEvent, renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileList } from '../profile-list'

/**
 * ProfileList currency-display tests (story 8-2, FR26 — code-review P1).
 *
 * A legacy profile persisted with a now-consolidated dollar code (`CAD`/`AUD`/
 * `MXN`) must render its canonical representative (`USD`) in the card, since the
 * shrunk selector no longer offers the retired code. Non-consolidated codes are
 * displayed unchanged. The app never converts currency — this is a display-only
 * relabel of an identical-rendering code.
 */
describe('ProfileList currency display (story 8-2)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  const seed = (currency: string) => {
    useProfileStore.setState({
      profiles: [
        {
          id: 'p1',
          userId: 'u1',
          name: 'Legacy Profile',
          isDefault: true,
          currency,
        },
      ],
      activeProfileId: 'p1',
    })
  }

  const currencyValue = () => {
    const label = screen.getByText('Currency:')
    // The rendered code lives in the sibling <span> within the same meta row.
    const row = label.parentElement as HTMLElement
    return within(row).getByText(/^[A-Z]{3}$|^NONE$/).textContent
  }

  it('renders a legacy CAD profile as the canonical USD', () => {
    seed('CAD')
    renderWithProviders(<ProfileList />)

    expect(currencyValue()).toBe('USD')
    expect(screen.queryByText('CAD')).toBeNull()
  })

  it('renders a legacy AUD profile as the canonical USD', () => {
    seed('AUD')
    renderWithProviders(<ProfileList />)

    expect(currencyValue()).toBe('USD')
  })

  it('leaves a non-consolidated currency (EUR) displayed unchanged', () => {
    seed('EUR')
    renderWithProviders(<ProfileList />)

    expect(currencyValue()).toBe('EUR')
  })
})

/**
 * Edit action (story 54.1, FR77).
 *
 * Every card gets an Edit action — unlike Delete, which is withheld from the
 * default profile and from a single-profile list. Its accessible name carries the
 * profile's name so several cards' Edit buttons are distinguishable.
 *
 * ⚠️ `getByRole`'s `name` is a FULL-STRING match: query the exact label.
 */
describe('ProfileList edit action (story 54.1)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  const main = { id: 'main', userId: 'u1', name: 'Main Profile', isDefault: true, currency: 'NONE' }
  const biz = { id: 'biz', userId: 'u1', name: 'Business', isDefault: false, currency: 'EUR' }

  it('offers Edit on the default profile when it is the only profile', () => {
    useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    expect(screen.getByRole('button', { name: 'Edit Main Profile' })).toBeInTheDocument()
    // Positive control for the visibility rules left untouched: no Delete here.
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('offers Edit on both the default and a non-default profile', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    expect(screen.getByRole('button', { name: 'Edit Main Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Business' })).toBeInTheDocument()
  })

  it('opens the Edit Profile dialog for the chosen profile', async () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    const user = userEvent.setup()
    renderWithProviders(<ProfileList />)

    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit Business' }))

    const dialog = screen.getByRole('dialog', { name: 'Edit Profile' })
    expect(within(dialog).getByLabelText(/profile name/i)).toHaveValue('Business')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('re-seeds the dialog when it switches straight to another profile (code review 54.1)', async () => {
    // `Modal` does not inert the background, so another card's Edit button stays
    // reachable while a dialog is open. Without a key the form kept the FIRST
    // profile's values and saved them onto the second.
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    const user = userEvent.setup()
    renderWithProviders(<ProfileList />)

    await user.click(screen.getByRole('button', { name: 'Edit Business' }))
    // Activate the background button directly (a bare click, no pointerdown), as a
    // browser-chrome focus round trip plus Enter can. A pointer gesture would hit
    // the overlay first and close the dialog, which hides the defect.
    const mainEdit = screen
      .getAllByRole('button', { hidden: true })
      .find((b) => b.getAttribute('aria-label') === 'Edit Main Profile')
    if (!mainEdit) throw new Error('Edit Main Profile button not found')
    fireEvent.click(mainEdit)

    const dialog = screen.getByRole('dialog', { name: 'Edit Profile' })
    expect(within(dialog).getByLabelText(/profile name/i)).toHaveValue('Main Profile')
  })
})
