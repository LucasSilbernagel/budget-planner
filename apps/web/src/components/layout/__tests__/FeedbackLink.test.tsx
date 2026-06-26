import { renderWithRouter, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../../utils/version'
import { FeedbackLink, GITHUB_REPO_URL, NEW_ISSUE_URL, buildIssueUrl } from '../FeedbackLink'

/**
 * FeedbackLink tests (story 4-9, AC-1).
 *
 * Covers the pure issue-URL builder (context encoding) and the accessible link
 * behavior (new-tab safety, current-page context in the href).
 */

describe('buildIssueUrl', () => {
  it('targets the canonical repository new-issue form', () => {
    const url = new URL(buildIssueUrl('/income', '1.2.3'))
    expect(`${url.origin}${url.pathname}`).toBe(NEW_ISSUE_URL)
    expect(NEW_ISSUE_URL.startsWith(GITHUB_REPO_URL)).toBe(true)
  })

  it('includes the current page path and app version in the prefilled body', () => {
    const params = new URL(buildIssueUrl('/savings', '0.4.2')).searchParams
    expect(params.get('title')).toContain('/savings')
    const body = params.get('body') ?? ''
    expect(body).toContain('- Page: /savings')
    expect(body).toContain('- App version: 0.4.2')
  })

  it('safely encodes paths containing reserved URL characters', () => {
    // A `&` in the path must not leak into a new query parameter.
    const params = new URL(buildIssueUrl('/income?tab=a&b', '1.0.0')).searchParams
    expect(params.get('body')).toContain('- Page: /income?tab=a&b')
  })
})

describe('FeedbackLink', () => {
  it('renders an accessible link that opens in a new tab', async () => {
    renderWithRouter(<FeedbackLink />, { path: '/' })
    const link = await screen.findByRole('link', { name: /report an issue or share feedback/i })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it("points at a context-filled issue URL for the user's current page", async () => {
    renderWithRouter(<FeedbackLink />, { path: '/expenses' })
    const link = await screen.findByRole('link')
    expect(link).toHaveAttribute('href', buildIssueUrl('/expenses', APP_VERSION))
  })
})
