import { renderWithProviders, screen, userEvent, waitFor } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../../stores/currencyStore'
import { RetirementForm } from '../RetirementForm'

/**
 * RetirementForm annual/monthly basis tests (story 15.2).
 *
 * Covers the desired-income basis selector and the boundary conversion:
 * - AC-1: the monthly/annual selector renders (default monthly) and the
 *   label/help text no longer hard-code "monthly".
 * - AC-2: entering an annual amount yields required assets numerically equal to
 *   entering annual/12 as a monthly amount (free tier runs the client-side core
 *   calc through useFinancialCalculations).
 * - AC-3: switching basis after a result is shown recomputes (no stale
 *   other-basis value) and the explanation names the basis used.
 * - AC-4: empty / non-numeric / negative input still surface the existing inline
 *   errors in both modes (strict Decision-A validation preserved).
 *
 * Currency preferences are forced to the currency-less default (mode 'none') so
 * amounts render as plain grouped decimals (e.g. "1,000,000.00").
 */
describe('RetirementForm — annual/monthly income basis (story 15.2)', () => {
  beforeEach(() => {
    // Currency-less default → deterministic "1,234.00"-style output, en-US locale.
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  })

  afterEach(() => {
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  })

  it('renders the basis selector defaulting to Monthly, with basis-neutral labels (AC-1)', () => {
    renderWithProviders(<RetirementForm preFillFromExistingData={false} />)

    const basis = screen.getByLabelText('Income period') as HTMLSelectElement
    expect(basis).toBeInTheDocument()
    expect(basis.value).toBe('monthly')
    expect(screen.getByRole('option', { name: 'Monthly' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Annual' })).toBeInTheDocument()

    // The income label / aria-label / help no longer assert "monthly".
    expect(screen.getByLabelText('Desired retirement income')).toBeInTheDocument()
    expect(screen.queryByText('Desired Monthly Retirement Income')).not.toBeInTheDocument()
    expect(screen.getByText('Enter the monthly income you want in retirement')).toBeInTheDocument()
  })

  it('updates the help text to "annual" when the basis is switched (AC-1)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementForm preFillFromExistingData={false} />)

    await user.selectOptions(screen.getByLabelText('Income period'), 'annual')
    expect(screen.getByText('Enter the annual income you want in retirement')).toBeInTheDocument()
  })

  it('an annual entry equals entering annual/12 as monthly (AC-2)', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(<RetirementForm preFillFromExistingData={false} />)

    // $60,000/yr @ 6% → $5,000/mo → $1,000,000 required assets.
    await user.selectOptions(screen.getByLabelText('Income period'), 'annual')
    await user.type(screen.getByLabelText('Desired retirement income'), '60000')
    await user.click(screen.getByRole('button', { name: 'Calculate Required Assets' }))

    await waitFor(() => {
      expect(screen.getByText('Required Retirement Assets')).toBeInTheDocument()
    })
    expect(container.textContent).toContain('1,000,000.00')
    // The per-month figure ($5,000) and the annual basis are both stated.
    expect(container.textContent).toContain('5,000.00/month')
    expect(container.textContent).toContain('based on your annual entry')
  })

  it('the same figure entered monthly vs annual produces different (correct) results (AC-2)', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(<RetirementForm preFillFromExistingData={false} />)

    // Monthly: $60,000/mo @ 6% → $12,000,000.
    await user.type(screen.getByLabelText('Desired retirement income'), '60000')
    await user.click(screen.getByRole('button', { name: 'Calculate Required Assets' }))

    await waitFor(() => {
      expect(container.textContent).toContain('12,000,000.00')
    })
    expect(container.textContent).toContain('based on your monthly entry')
  })

  it('switching basis after a result recomputes it — no stale other-basis value (AC-3)', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(<RetirementForm preFillFromExistingData={false} />)

    // Start monthly: $60,000/mo @ 6% → $12,000,000.
    await user.type(screen.getByLabelText('Desired retirement income'), '60000')
    await user.click(screen.getByRole('button', { name: 'Calculate Required Assets' }))
    await waitFor(() => {
      expect(container.textContent).toContain('12,000,000.00')
    })

    // Flip to annual: same typed number now means $60,000/yr → $5,000/mo → $1,000,000.
    await user.selectOptions(screen.getByLabelText('Income period'), 'annual')

    await waitFor(() => {
      expect(container.textContent).toContain('1,000,000.00')
    })
    // The old monthly-basis result must be gone (no silent unit mismatch).
    expect(container.textContent).not.toContain('12,000,000.00')
    expect(container.textContent).toContain('based on your annual entry')
    // The typed number is left exactly as entered — only its interpretation changed.
    expect(
      (screen.getByLabelText('Desired retirement income') as HTMLInputElement).value
    ).toContain('60,000')
  })

  it('empty input errors in both modes (AC-4)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementForm preFillFromExistingData={false} />)

    // Monthly (default).
    await user.click(screen.getByRole('button', { name: 'Calculate Required Assets' }))
    await waitFor(() => {
      expect(screen.getByText('Please enter a retirement income')).toBeInTheDocument()
    })
    expect(screen.queryByText('Required Retirement Assets')).not.toBeInTheDocument()

    // Annual.
    await user.selectOptions(screen.getByLabelText('Income period'), 'annual')
    await user.click(screen.getByRole('button', { name: 'Calculate Required Assets' }))
    await waitFor(() => {
      expect(screen.getByText('Please enter a retirement income')).toBeInTheDocument()
    })
    expect(screen.queryByText('Required Retirement Assets')).not.toBeInTheDocument()
  })

  it('non-numeric input errors (monthly mode) with no result (AC-4)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementForm preFillFromExistingData={false} />)

    await user.type(screen.getByLabelText('Desired retirement income'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Calculate Required Assets' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.queryByText('Required Retirement Assets')).not.toBeInTheDocument()
  })

  it('negative input errors (annual mode) with no result (AC-4)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementForm preFillFromExistingData={false} />)

    await user.selectOptions(screen.getByLabelText('Income period'), 'annual')
    await user.type(screen.getByLabelText('Desired retirement income'), '-100')
    await user.click(screen.getByRole('button', { name: 'Calculate Required Assets' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.queryByText('Required Retirement Assets')).not.toBeInTheDocument()
  })
})
