/**
 * SettingsPage tests (story 11-6).
 *
 * The consolidated home for the display preferences that used to be scattered
 * across page headers (currency) and the footer (theme). These assert the surface
 * hosts the currency control and that its global scope is spelled out (AC-2).
 *
 * ⚠️ There used to be a dark-mode toggle here too, and a test pinning exactly one
 * instance of it (story 7-3 DECISION 2). Story 61.1 (FR93) deleted the control:
 * the theme follows the device's `prefers-color-scheme` and nothing in the app can
 * disagree with it. That test is now inverted — it asserts the ABSENCE, with a
 * positive control, rather than being deleted outright.
 *
 * The `usePremiumAccess` mock is retained only to keep any incidental consumer
 * deterministic; the currency control uses the real store.
 */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SessionSeed, SessionSeedProvider } from '../../../context/session-seed'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../../auth/premium-prompt', () => ({
  PremiumPrompt: () => <div data-testid="premium-prompt" />,
}))

// AccountSection is a separate unit (10-5) with its own session fetch + router
// deps and its own test. Stub it here so this suite stays focused on the page's
// composition and does not warn about `useRouter` outside a RouterProvider.
vi.mock('../account-section', () => ({
  AccountSection: () => <div data-testid="account-section" />,
}))

import { SettingsPage } from '../settings-page'

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
  usePremiumAccess.mockReturnValue({
    status: {
      hasAccess: false,
      subscriptionStatus: null,
      isLoading: false,
      error: null,
      isAuthenticated: false,
      ...overrides,
    } satisfies PremiumAccessStatus,
  })
}

// Both AccountSection (10-5) and LocalDataSection (17-2) resolve the session via
// `fetch('/api/auth/me')` on mount. Stub it to a no-session response so the mounted
// SettingsPage neither hits the MSW "unhandled request" path nor makes a real call.
const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    if (String(input).includes('/api/auth/me')) {
      return Promise.resolve(new Response(JSON.stringify({ user: null }), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof global.fetch
  mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
})
afterEach(() => {
  global.fetch = originalFetch
})

describe('SettingsPage', () => {
  it('renders a Settings heading and a Display section', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /^display$/i })).toBeInTheDocument()
  })

  it('consolidates the currency control here, with its global scope made explicit (AC-2)', () => {
    render(<SettingsPage />)
    // The relocated currency toggle (its accessible group name).
    expect(screen.getByRole('group', { name: /currency display/i })).toBeInTheDocument()
    // Scope is no longer ambiguous: copy states it applies app-wide.
    expect(screen.getByText(/applies everywhere amounts are shown/i)).toBeInTheDocument()
  })

  it('hosts NO dark-mode toggle — the theme follows the device (61.1, FR93)', () => {
    render(<SettingsPage />)

    // POSITIVE CONTROL. `getAllByRole` THROWS when nothing matches (it is built
    // with `getMissingError`), so a surface that rendered no switches at all
    // already fails loudly on the next line — this is not the case that needs
    // guarding, and an earlier version of this comment wrongly claimed it was.
    //
    // ⚠️ WHAT THIS DOES NOT CATCH, stated precisely so the next reader does not
    // over-trust it: a dark-mode control RENAMED to "Appearance" or "Theme" would
    // still satisfy both the throw-on-empty above and the `/dark mode/i` filter
    // below, and the absence would read as success. Renames are guarded by the
    // e2e case in `e2e/theme-dark-mode.spec.ts` plus the deletion of the component
    // file itself, not here.
    const switches = screen.getAllByRole('switch')

    // Story 7-3 DECISION 2 pinned exactly ONE dark-mode switch here. Story 61.1
    // reversed that decision: the toggle, its store, its provider and its <head>
    // bootstrap are all deleted, so a re-introduced control would be a second
    // source of truth for the theme.
    const darkModeSwitches = switches.filter((el) =>
      /dark mode/i.test(el.getAttribute('aria-label') ?? el.textContent ?? '')
    )
    expect(darkModeSwitches).toHaveLength(0)
  })

  // Story 17-2: the "Clear local data" control is for EVERY user, unlike the
  // auth-gated Premium "Delete account" control.
  it('surfaces the all-users "Clear local data" control, even for a free/unauthenticated user (17-2 AC-1)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
    render(<SettingsPage />)
    expect(screen.getByRole('button', { name: /clear local data/i })).toBeInTheDocument()
  })

  // Story 30-3: the financial summary report is reached from here. Unlike
  // "Clear local data" it is Premium, so it is surfaced-but-locked for a free
  // visitor rather than hidden — the gate's own suite covers every tier state;
  // these two assert only that the section is composed into this page.
  it('hosts the Premium financial summary section, locked for a free user (30-3)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
    render(<SettingsPage />)

    expect(
      screen.getByRole('heading', { level: 2, name: /^financial summary$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Financial Summary Report — premium, locked' })
    ).toBeInTheDocument()
  })

  it('links an active Premium user from Settings to the report (30-3)', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<SettingsPage />)
    expect(screen.getByRole('link', { name: /financial summary report/i })).toHaveAttribute(
      'href',
      '/report'
    )
  })

  // Story 30.4b: category management is reached from here too. Same shape as the
  // report section above — the gate's own suite covers every tier state; these
  // two assert only that the section is composed into this page.
  it('hosts the Premium categories section, locked for a free user (30.4b)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
    render(<SettingsPage />)

    expect(screen.getByRole('heading', { level: 2, name: /^categories$/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Custom Categories — premium, locked' })
    ).toBeInTheDocument()
  })

  it('links an active Premium user from Settings to category management (30.4b)', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<SettingsPage />)
    expect(screen.getByRole('link', { name: /custom categories/i })).toHaveAttribute(
      'href',
      '/categories'
    )
  })
})

/**
 * The two premium sections on /settings are tier-conditional (story 58.2, D2).
 *
 * Story 58.1 put Report and Categories into a paid user's nav, so their Settings
 * tiles became duplication by FR88's own argument. D2 (Lucas, 2026-09-20) hides
 * both sections for an entitled session. This is a DECLARED EXPANSION beyond
 * FR88, which names only the Overview grid.
 *
 * ⚠️ The gate lives at the CALL SITES in `settings-page.tsx`, never inside
 * `ReportSection` / `CategoriesSection`. Those components stay tier-blind, so
 * their own suites keep covering all three tier states unchanged — if
 * `report-section.test.tsx` or `categories-section.test.tsx` ever go red for
 * this story, the gate was put in the wrong place.
 *
 * ⚠️⚠️ TIER HERE IS THE SESSION SEED, NOT THE `usePremiumAccess` MOCK. The TWO
 * pre-existing tests above that drive `hasAccess: true` (the report link and the
 * categories link) render with no `SessionSeedProvider`, so the seed is `null`,
 * the gate fails OPEN and both sections render — which is why they still pass
 * unchanged. They exercise the GATE's entitled branch, not a paid user's Settings
 * page. This block is the only test of the latter.
 * (Count corrected from "four" in code review, 2026-09-21.)
 */
describe('58.2: the premium Settings sections are tier-conditional (D2)', () => {
  function paidSeed(overrides: Partial<SessionSeed> = {}): SessionSeed {
    return {
      isAuthenticated: true,
      userId: 'u1',
      email: 'u1@example.test',
      subscriptionStatus: 'active',
      ...overrides,
    }
  }

  function renderWithSeed(seed: SessionSeed | null) {
    return render(
      <SessionSeedProvider seed={seed}>
        <SettingsPage />
      </SessionSeedProvider>
    )
  }

  /**
   * The positive anchor for every absence assertion below: proof the page
   * rendered at all. An empty render, a crash and a correct trim are otherwise
   * indistinguishable to `queryBy… === null`.
   */
  function expectPageRendered(): void {
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /^display$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear local data/i })).toBeInTheDocument()
    expect(screen.getByTestId('account-section')).toBeInTheDocument()
  }

  it.each(['active', 'lifetime'] as const)(
    'renders neither premium section for a %s session',
    (subscriptionStatus) => {
      mockStatus({ hasAccess: true, subscriptionStatus, isAuthenticated: true })
      renderWithSeed(paidSeed({ subscriptionStatus }))

      expectPageRendered()

      // The whole <section> goes, heading and explanatory copy included — not
      // just the gate box inside it.
      expect(screen.queryByRole('heading', { level: 2, name: /^financial summary$/i })).toBeNull()
      expect(screen.queryByRole('heading', { level: 2, name: /^categories$/i })).toBeNull()
      expect(screen.queryByRole('link', { name: /financial summary report/i })).toBeNull()
      expect(screen.queryByRole('link', { name: /custom categories/i })).toBeNull()
      expect(screen.queryByText(/a printable summary of your budget/i)).toBeNull()
      expect(screen.queryByText(/your own income and expense groupings/i)).toBeNull()
    }
  )

  it('takes the report privacy sentence with it — NOT re-homed to /report (AC-5)', () => {
    // ⚠️⚠️ THE TRAP THIS TEST GUARDS. Removing this section takes away the line
    // "The summary is assembled in your browser — nothing is sent anywhere to
    // produce it" for a paid user, and the obvious fix is to move it onto the
    // /report page — which is exactly what story 57.1 correctly did for
    // /forecasting. It is WRONG here: story 56.1 / UX-DR62 removed that
    // disclaimer from the report deliberately, and
    // `reports/__tests__/FinancialSummaryReport.test.tsx` PINS ITS ABSENCE with
    // `not.toMatch`. Re-adding it reverses a shipped decision AND turns that
    // guard red. The claim survives for paid users in /docs (features.md).
    //
    // Generalisable: before relocating any copy, grep for a pinned ABSENCE of it.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    renderWithSeed(paidSeed())

    expectPageRendered()
    expect(screen.queryByText(/nothing is sent anywhere to produce it/i)).toBeNull()
  })

  // ⚠️ The SEED drives the new gate; `mockStatus` drives the gates inside each
  // section and is set to the tier that seed would really resolve to, so the
  // fixture is coherent (code review, 2026-09-21).
  it.each([
    ['a null seed (resolver could not verify)', null, { isAuthenticated: false }],
    [
      'an unauthenticated seed',
      { isAuthenticated: false, userId: null, email: null, subscriptionStatus: null },
      { isAuthenticated: false },
    ],
    ['a free session', { subscriptionStatus: 'free' as const }, { isAuthenticated: true }],
    ['a past_due session', { subscriptionStatus: 'past_due' as const }, { isAuthenticated: true }],
    ['a canceled session', { subscriptionStatus: 'canceled' as const }, { isAuthenticated: true }],
  ])('renders both premium sections, unchanged, for %s (AC-6)', (_label, overrides, tier) => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', ...tier })
    renderWithSeed(overrides === null ? null : paidSeed(overrides as Partial<SessionSeed>))

    expectPageRendered()
    expect(
      screen.getByRole('heading', { level: 2, name: /^financial summary$/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /^categories$/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Financial Summary Report — premium, locked' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Custom Categories — premium, locked' })
    ).toBeInTheDocument()
    // The free tier keeps the privacy sentence exactly as today.
    expect(screen.getByText(/nothing is sent anywhere to produce it/i)).toBeInTheDocument()
  })

  it('⚠️ FAILS OPEN on a null seed — the OPPOSITE of the nav, deliberately', () => {
    // Same asymmetry as the Overview gate: after story 58.2 the nav is the only
    // paid route to /report and /categories (their Settings tiles were the last
    // fallback), so failing CLOSED on an unverified seed would strand a paid
    // user with no route at all. Showing them a section they do not need is
    // merely redundant. Do not "harmonise" this with GlobalNav's direction.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    renderWithSeed(null)

    expectPageRendered()
    expect(
      screen.getByRole('heading', { level: 2, name: /^financial summary$/i }),
      'a null seed must FAIL OPEN and still show the section'
    ).toBeInTheDocument()

    // ⚠️ The assertion that actually tests the rationale: the user must retain a
    // ROUTE, not just a heading. An earlier version stopped at the heading and
    // would have passed against two inert sections (code review, 2026-09-21).
    expect(screen.getByRole('link', { name: /financial summary report/i })).toHaveAttribute(
      'href',
      '/report'
    )
    expect(screen.getByRole('link', { name: /custom categories/i })).toHaveAttribute(
      'href',
      '/categories'
    )
  })
})
