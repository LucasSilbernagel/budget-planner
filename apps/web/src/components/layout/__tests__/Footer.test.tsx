import { renderWithProviders, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../../utils/version'
import { Footer } from '../Footer'

/**
 * Footer component tests (story 4-8, AC-1).
 *
 * Covers: the footer renders as an accessible landmark and displays the
 * application version sourced from package.json.
 */
describe('Footer', () => {
  it('renders a contentinfo landmark', () => {
    renderWithProviders(<Footer />)
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('displays the application version', () => {
    renderWithProviders(<Footer />)
    expect(screen.getByText(`v${APP_VERSION}`)).toBeInTheDocument()
  })

  it('exposes the version to assistive tech with a label', () => {
    renderWithProviders(<Footer />)
    expect(
      screen.getByLabelText(new RegExp(`version ${APP_VERSION.replace(/\./g, '\\.')}`, 'i'))
    ).toBeInTheDocument()
  })
})
