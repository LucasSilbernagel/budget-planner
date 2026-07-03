import { useProfileStore } from '@/stores/profileStore'
import { renderWithProviders, screen, within } from '@/test/utils'
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
