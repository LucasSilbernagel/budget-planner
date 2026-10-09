import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Link,
	Outlet,
	RouterProvider,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderWithRouter, screen, userEvent, waitFor, within } from '@/test/utils'

import type { SessionSeed } from '../../../context/session-seed'
import { SessionSeedProvider } from '../../../context/session-seed-provider'

/** Wrapped, not replaced: the real body runs, and the spy proves the menu reaches it. */
vi.mock('@/lib/account/sign-out', async (importOriginal) => {
	const real = await importOriginal<typeof import('@/lib/account/sign-out')>()
	return {
		...real,
		signOut: vi.fn(real.signOut),
		returnToSignedOutHome: vi.fn(real.returnToSignedOutHome),
	}
})

import { resetSignOutStateForTests, signOut } from '@/lib/account/sign-out'
import { expectSharedGreen } from '@/test/white-fill-tokens'
import { AuthIndicator } from '../auth-indicator'

const accountStatus = () => screen.getByRole('status', { name: /account status/i })
/** Awaited: `renderWithRouter` mounts after the router loads. */
const findAccountStatus = () => screen.findByRole('status', { name: /account status/i })

const originalFetch = global.fetch

function stubFetch({ user, fail }: { user?: unknown; fail?: boolean }) {
	global.fetch = vi.fn((input: RequestInfo | URL) => {
		const url = String(input)
		if (url.includes('/api/auth/me')) {
			if (fail) {
				return Promise.reject(new Error('network down'))
			}
			return Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))
		}
		return Promise.resolve(new Response('{}', { status: 200 }))
	}) as typeof global.fetch
}

/**
 * Holds /api/auth/me open so what shows comes from the SSR seed. It doesn't freeze the first
 * paint: effects flush before any assertion, so first-paint claims need serverRenderAt.
 */
function stubFetchPending() {
	global.fetch = vi.fn((input: RequestInfo | URL) => {
		if (String(input).includes('/api/auth/me')) {
			return new Promise<Response>(() => {})
		}
		return Promise.resolve(new Response('{}', { status: 200 }))
	}) as typeof global.fetch
}

function renderSeeded(seed: SessionSeed | null, path?: string) {
	return renderWithRouter(
		<SessionSeedProvider seed={seed}>
			<AuthIndicator />
		</SessionSeedProvider>,
		path === undefined ? undefined : { path }
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	// `signOut()` dedupes at module level; a suite that holds the logout POST
	// open would otherwise leave that promise pending for every later test.
	resetSignOutStateForTests()
})
afterEach(() => {
	global.fetch = originalFetch
	vi.restoreAllMocks()
})

function renderWithNavigableRouter() {
	// jsdom has no window.scrollTo; TanStack's scroll restoration calls it on navigation.
	window.scrollTo = (() => {}) as typeof window.scrollTo
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<AuthIndicator />
				<Outlet />
				<Link to="/forecasting">go-other</Link>
			</>
		),
	})
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: '/',
		component: () => <div>home</div>,
	})
	const otherRoute = createRoute({
		getParentRoute: () => rootRoute,
		// A registered path AuthIndicator doesn't special-case.
		path: '/forecasting',
		component: () => <div>other</div>,
	})
	// `renderWithRouter`'s path only seeds a first paint; navigation needs a real /login route.
	const loginRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: '/login',
		component: () => <div>login</div>,
	})
	const settingsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: '/settings',
		component: () => <div>settings</div>,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, otherRoute, loginRoute, settingsRoute]),
		history: createMemoryHistory({ initialEntries: ['/'] }),
	})
	render(<RouterProvider router={router} />)
	return { router }
}

describe('AuthIndicator', () => {
	it('shows a "Sign in" link to /login and no account info when signed out', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />)

		const signIn = await screen.findByRole('link', { name: /sign in/i })
		expect(signIn).toHaveAttribute('href', '/login')
		expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/@/)).not.toBeInTheDocument()
	})

	it('fails closed to the signed-out affordance if the session fetch rejects', async () => {
		stubFetch({ fail: true })
		renderWithRouter(<AuthIndicator />)

		expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
		expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
	})

	it('shows the email and a Premium marker for an active subscription', async () => {
		stubFetch({
			user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' },
		})
		renderWithRouter(<AuthIndicator />)

		const indicator = await screen.findByRole('status')
		expect(await within(indicator).findByText('user@example.com')).toBeInTheDocument()
		expect(within(indicator).getByText(/^premium$/i)).toBeInTheDocument()
		expectSharedGreen(within(indicator).getByText(/^premium$/i))
		expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
	})

	it.each(['free', 'past_due', 'canceled'])(
		'shows the email but NO Premium marker for a %s subscription',
		async (subscriptionStatus) => {
			stubFetch({
				user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus },
			})
			renderWithRouter(<AuthIndicator />)

			// Wait for the session to resolve before asserting absence.
			expect(
				await within(await findAccountStatus()).findByText('user@example.com')
			).toBeInTheDocument()
			expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
		}
	)

	it('keeps a stable indicator container through loading → resolved (no layout collapse)', async () => {
		// The container must exist (height reserved) before the session resolves.
		let resolveFetch: (value: Response) => void = () => {}
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input).includes('/api/auth/me')) {
				return new Promise<Response>((resolve) => {
					resolveFetch = resolve
				})
			}
			return Promise.resolve(new Response('{}', { status: 200 }))
		}) as typeof global.fetch

		renderWithRouter(<AuthIndicator />)

		const indicator = await screen.findByRole('status')
		expect(indicator).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()

		resolveFetch(new Response(JSON.stringify({ user: null }), { status: 200 }))
		expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument()
		expect(screen.getByRole('status')).toBe(indicator)
	})

	it('re-resolves on navigation so it does not show a stale identity after sign-out', async () => {
		let currentUser: unknown = {
			userId: 'user-1',
			email: 'user@example.com',
			subscriptionStatus: 'active',
		}
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input).includes('/api/auth/me')) {
				return Promise.resolve(new Response(JSON.stringify({ user: currentUser }), { status: 200 }))
			}
			return Promise.resolve(new Response('{}', { status: 200 }))
		}) as typeof global.fetch

		const { router } = renderWithNavigableRouter()
		expect(
			await within(await findAccountStatus()).findByText('user@example.com')
		).toBeInTheDocument()
		expect(screen.getByText(/^premium$/i)).toBeInTheDocument()

		// The session ended elsewhere: navigating must drop the stale email and marker.
		currentUser = null
		await act(async () => {
			await router.navigate({ to: '/forecasting' })
		})

		expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument()
		expect(screen.queryByText('user@example.com')).not.toBeInTheDocument()
		expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
	})

	it('treats a user object without an email as signed-out (no render crash)', async () => {
		// Contract drift: a payload missing `email` must not white-screen the app root.
		stubFetch({ user: { userId: 'user-1', subscriptionStatus: 'active' } })
		renderWithRouter(<AuthIndicator />)

		expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
		expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
	})

	// No `sm:min-w-0`: it let the row shrink below its content and push over the nav.
	// Class tokens, because jsdom computes no layout.
	it('keeps the outer row at its content width, with no visible email left in it', async () => {
		stubFetch({
			user: {
				userId: 'user-1',
				email: 'a.long.address@example.test',
				subscriptionStatus: 'active',
			},
		})
		const { container } = renderWithRouter(<AuthIndicator />)
		await within(await findAccountStatus()).findByText('a.long.address@example.test')
		const row = container.querySelector('[data-auth-indicator]') as HTMLElement
		expect(row, 'the outer row carries `data-auth-indicator`').not.toBeNull()
		expect(row.contains(accountStatus()), 'the status region sits inside the row').toBe(true)
		const rowTokens = [...row.classList]
		expect(rowTokens, 'the strip can shrink below its content again').not.toContain('sm:min-w-0')
		expect(rowTokens).not.toContain('min-w-0')
		expect(rowTokens, 'a wrapped cluster would lose its right alignment').toContain('sm:ml-auto')
		const copies = screen.getAllByText('a.long.address@example.test')
		expect(copies).toHaveLength(1)
		expect([...copies[0].classList]).toContain('sr-only')
	})
})

describe('AuthIndicator — "Upgrade" affordance', () => {
	it('offers "Upgrade" to /pricing alongside "Sign in" when signed out', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />)

		const upgrade = await screen.findByRole('link', { name: 'Upgrade' })
		expect(upgrade).toHaveAttribute('href', '/pricing')
		expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument()
	})

	it('hides "Upgrade" on /pricing itself (self-link) but keeps "Sign in"', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />, { path: '/pricing' })

		expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument()
	})

	it('hides "Upgrade" on /login too — that page keeps its deliberately-empty strip', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />, { path: '/login' })

		const indicator = await screen.findByRole('status', { name: /account status/i })
		await waitFor(() => {
			expect(indicator.children).toHaveLength(0)
		})
		expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument()
	})

	it('never shows "Upgrade" for an authenticated user', async () => {
		stubFetch({
			user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' },
		})
		renderWithRouter(<AuthIndicator />)

		expect(
			await within(await findAccountStatus()).findByText('user@example.com')
		).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument()
	})
})

describe('AuthIndicator — SSR seed', () => {
	it('paints the email + Premium marker for an active seed while the refetch is pending', async () => {
		stubFetchPending()
		renderSeeded({
			isAuthenticated: true,
			userId: 'user-1',
			email: 'user@example.com',
			subscriptionStatus: 'active',
		})

		// `/api/auth/me` never resolves, so the SSR seed drives the first paint.
		expect(
			await within(await findAccountStatus()).findByText('user@example.com')
		).toBeInTheDocument()
		expect(screen.getByText(/^premium$/i)).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
	})

	it('paints the email but NO Premium marker for a free seed while the refetch is pending', async () => {
		stubFetchPending()
		renderSeeded({
			isAuthenticated: true,
			userId: 'user-1',
			email: 'user@example.com',
			subscriptionStatus: 'free',
		})

		expect(
			await within(await findAccountStatus()).findByText('user@example.com')
		).toBeInTheDocument()
		expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
	})

	it('paints the "Sign in" affordance for a signed-out seed while the refetch is pending', async () => {
		stubFetchPending()
		renderSeeded({
			isAuthenticated: false,
			userId: null,
			email: null,
			subscriptionStatus: null,
		})

		expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
		expect(screen.queryByText(/@/)).not.toBeInTheDocument()
		expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
	})
})

/**
 * Asserts a contrast, not just an absence: tests at `/` stay green against a /login-only
 * regression. jsdom has no layout, so the strip not collapsing isn't proven here.
 */
/** `renderToString` runs no effects, so only this sees the first paint. `router.load()` first. */
async function serverRenderAt(path: string): Promise<string> {
	const rootRoute = createRootRoute({
		component: () => (
			<SessionSeedProvider
				seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
			>
				<AuthIndicator />
			</SessionSeedProvider>
		),
	})
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: [path] }),
	})
	await router.load()
	return renderToString(<RouterProvider router={router} />)
}

describe('AuthIndicator — the sign-in page', () => {
	it('drops the "Sign in" link on /login and leaves the status region empty', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />, { path: '/login' })

		const indicator = await screen.findByRole('status', { name: /account status/i })
		// Proof of resolution: before it, the loading placeholder would pass "no link" vacuously.
		await waitFor(() => {
			expect(indicator.children).toHaveLength(0)
		})

		expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
		expect(screen.getByRole('status', { name: /account status/i })).toBe(indicator)
	})

	it('still offers the "Sign in" link on a route that is not /login', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />, { path: '/pricing' })

		const signIn = await screen.findByRole('link', { name: /sign in/i })
		expect(signIn).toHaveAttribute('href', '/login')
		const indicator = screen.getByRole('status', { name: /account status/i })
		expect(indicator.contains(signIn)).toBe(true)
	})

	it('drops the link on /login?error=… too, where a failed sign-in lands', async () => {
		// `location.pathname` excludes the search string, so the exact match holds.
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />, { path: '/login?error=invalid_or_expired' })

		const indicator = await screen.findByRole('status', { name: /account status/i })
		await waitFor(() => {
			expect(indicator.children).toHaveLength(0)
		})
		expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
	})

	it.each(['/Login', '/LOGIN', '/lOgIn'])(
		'drops the link on %s too — route matching is case-insensitive, the pathname is not',
		async (path) => {
			// Routes match case-insensitively but pathname keeps the typed case, so `/Login`
			// serves the sign-in page.
			stubFetch({ user: null })
			renderWithRouter(<AuthIndicator />, { path })

			const indicator = await screen.findByRole('status', { name: /account status/i })
			await waitFor(() => {
				expect(indicator.children).toHaveLength(0)
			})
			expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
		}
	)

	it('renders no "Sign in" affordance on /login from a signed-out seed', async () => {
		// Doesn't prove there's no first-paint flash: effects flush before findByRole resolves.
		// The server-render test carries that claim.
		stubFetchPending()
		renderSeeded(
			{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null },
			'/login'
		)

		const indicator = await screen.findByRole('status', { name: /account status/i })
		expect(indicator.children).toHaveLength(0)
		expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
	})

	it('server-renders /login with the strip but WITHOUT the "Sign in" link — no first-paint flash', async () => {
		// The first-paint assertion: renderToString runs no effects (hence no fetch stub). The
		// `/` arm is the positive control.

		const loginHtml = await serverRenderAt('/login')
		const homeHtml = await serverRenderAt('/')

		expect(homeHtml).toContain('Sign in')
		expect(loginHtml).not.toContain('Sign in')
		expect(loginHtml).toContain('Account status')
		expect(homeHtml).toContain('Account status')
	})

	it('leaves the loading placeholder untouched on /login', async () => {
		// The route check is for the unauthenticated branch only; loading still renders.
		stubFetchPending()
		renderWithRouter(<AuthIndicator />, { path: '/login' })

		const indicator = await screen.findByRole('status', { name: /account status/i })
		expect(indicator.querySelector('span[aria-hidden="true"]')).not.toBeNull()
		expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
	})

	it('shows the authenticated state on /login exactly as elsewhere', async () => {
		// No route guards exist, so an authenticated user genuinely reaches /login.
		stubFetchPending()
		renderSeeded(
			{
				isAuthenticated: true,
				userId: 'user-1',
				email: 'user@example.com',
				subscriptionStatus: 'active',
			},
			'/login'
		)

		const indicator = await screen.findByRole('status', { name: /account status/i })
		expect(await within(indicator).findByText('user@example.com')).toBeInTheDocument()
		expect(within(indicator).getByText(/^premium$/i)).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
	})

	it('flips the affordance on client-side navigation into and out of /login', async () => {
		// The strip never remounts, so a branch read only at mount would pass first-paint
		// tests and still be wrong after navigating.
		stubFetch({ user: null })
		const { router } = renderWithNavigableRouter()

		expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')

		await act(async () => {
			await router.navigate({ to: '/login' })
		})
		await waitFor(() => {
			expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
		})
		expect(screen.getByRole('status', { name: /account status/i })).toBeInTheDocument()

		await act(async () => {
			await router.navigate({ to: '/' })
		})
		expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument()
	})
})

/**
 * The panel renders only while open, which makes the absence assertions meaningful. jsdom
 * has no layout or media queries: structure, ARIA, behaviour and class tokens only.
 */
describe('AuthIndicator — account menu', () => {
	const USER = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' }
	const trigger = () => screen.getByRole('button', { name: 'Account menu' })
	const panel = () => {
		const id = trigger().getAttribute('aria-controls')
		return id === null ? null : document.getElementById(id)
	}

	async function renderSignedIn(user: Record<string, string> = USER) {
		stubFetch({ user })
		const result = renderWithRouter(<AuthIndicator />)
		await within(await findAccountStatus()).findByText(user.email)
		return result
	}

	it('offers a closed "Account menu" disclosure beside, not inside, the live region', async () => {
		await renderSignedIn()

		const button = trigger()
		// Exact: a compound name would break every full-string getByRole probe.
		expect(button).toHaveAccessibleName('Account menu')
		expect(button).toHaveAttribute('type', 'button')
		expect(button).toHaveAttribute('aria-expanded', 'false')
		expect(button).not.toHaveAttribute('aria-haspopup')
		// No aria-controls while closed: the panel doesn't exist (a dangling IDREF).
		expect(button).not.toHaveAttribute('aria-controls')
		// Closed = absent, not merely hidden.
		expect(document.querySelector('[role="dialog"], hr')).toBeNull()
		expect(screen.queryByRole('button', { name: /^sign out$/i })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /^sign out$/i })).not.toBeInTheDocument()
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()

		// An interactive control inside a polite live region announces spuriously.
		expect(accountStatus().contains(button)).toBe(false)
		expect(accountStatus().querySelector('button, a, [tabindex]')).toBeNull()
	})

	it.each(['active', 'lifetime', 'free', 'past_due', 'canceled'])(
		'a %s user: the trigger is [avatar][chevron], with no email in it',
		async (subscriptionStatus) => {
			await renderSignedIn({ ...USER, subscriptionStatus })
			const button = trigger()
			expect(button).toHaveTextContent(/^U$/)
			expect(button.textContent).not.toContain('@')
			expect(button.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
			expect(button).toHaveAccessibleName('Account menu')
		}
	)

	it('keeps the Premium pill outside the trigger and the email announced', async () => {
		await renderSignedIn()

		const button = trigger()

		const pill = within(accountStatus()).getByText(/^premium$/i)
		expect(button.contains(pill)).toBe(false)
		const announced = within(accountStatus()).getByText('user@example.com')
		expect([...announced.classList]).toContain('sr-only')
	})

	it('renders no trigger for a signed-out visitor or while the session is loading', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />)
		await screen.findByRole('link', { name: /sign in/i })
		expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
	})

	it('renders no trigger in the loading state', async () => {
		stubFetchPending()
		renderWithRouter(<AuthIndicator />)
		await screen.findByRole('status')
		expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
	})

	it('opens to exactly Settings, a separator and Sign out', async () => {
		const { container } = await renderSignedIn()
		const user = userEvent.setup()

		await user.click(trigger())

		expect(trigger()).toHaveAttribute('aria-expanded', 'true')
		expect(trigger().getAttribute('aria-controls')).toBeTruthy()
		const open = panel()
		expect(open, 'aria-controls does not resolve to the panel').not.toBeNull()
		const el = open as HTMLElement
		// Anchored: an extra row turns this red, where a substring check would stay green.
		expect(el).toHaveTextContent(/^Settings\s*Sign out$/)
		expect([...el.children].map((c) => c.tagName)).toEqual(['A', 'HR', 'BUTTON'])
		const settings = within(el).getByRole('link', { name: 'Settings' })
		expect(settings).toHaveAttribute('href', '/settings')
		expect(within(el).getAllByRole('link')).toHaveLength(1)
		expect(within(el).getAllByRole('button')).toHaveLength(1)
		expect(within(el).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
		// jsdom renders all three, but below 640px Settings and the separator are hidden.
		// Token membership, not substring. Sign out must not carry it.
		expect([...settings.classList], 'the Settings row shows on a phone').toContain('max-sm:hidden')
		const hr = el.querySelector(':scope > hr') as HTMLElement
		expect([...hr.classList], 'a phone panel would open on a separator').toContain('max-sm:hidden')
		expect(
			[...within(el).getByRole('button', { name: 'Sign out' }).classList],
			'Sign out is hidden on a phone'
		).not.toContain('max-sm:hidden')
		expect(el.textContent).not.toContain('@')
		// The panel is not a second live region.
		expect(accountStatus().contains(el)).toBe(false)
		expect(container.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1)
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()
		// Disclosure convention: opening does not move focus into the panel.
		expect(trigger()).toHaveFocus()
		await user.tab()
		expect(settings).toHaveFocus()
		await user.tab()
		expect(within(el).getByRole('button', { name: 'Sign out' })).toHaveFocus()
	})

	it('marks the Settings row current on /settings, and only there', async () => {
		stubFetch({ user: USER })
		renderWithRouter(<AuthIndicator />, { path: '/settings' })
		await within(await findAccountStatus()).findByText(USER.email)
		const user = userEvent.setup()
		await user.click(trigger())
		expect(within(panel() as HTMLElement).getByRole('link', { name: 'Settings' })).toHaveAttribute(
			'aria-current',
			'page'
		)
	})

	it('marks the Settings row current on /Settings too (case-insensitive)', async () => {
		stubFetch({ user: USER })
		renderWithRouter(<AuthIndicator />, { path: '/Settings' })
		await within(await findAccountStatus()).findByText(USER.email)
		const user = userEvent.setup()
		await user.click(trigger())
		expect(within(panel() as HTMLElement).getByRole('link', { name: 'Settings' })).toHaveAttribute(
			'aria-current',
			'page'
		)
	})

	it('does not mark the Settings row current elsewhere', async () => {
		await renderSignedIn()
		const user = userEvent.setup()
		await user.click(trigger())
		expect(
			within(panel() as HTMLElement).getByRole('link', { name: 'Settings' })
		).not.toHaveAttribute('aria-current')
	})

	// On /settings, clicking Settings changes no pathname and the press stays inside the
	// menu, so only the link's own onClick closes the panel.
	it('closes when Settings is chosen on /settings itself (same route), focus back on the trigger', async () => {
		stubFetch({ user: USER })
		renderWithRouter(<AuthIndicator />, { path: '/settings' })
		await within(await findAccountStatus()).findByText(USER.email)
		const user = userEvent.setup()
		await user.click(trigger())
		await user.click(within(panel() as HTMLElement).getByRole('link', { name: 'Settings' }))
		expect(panel(), 'the panel stayed open after a same-route click on Settings').toBeNull()
		expect(trigger()).toHaveAttribute('aria-expanded', 'false')
		expect(trigger()).toHaveFocus()
	})

	it('toggles closed on a second click', async () => {
		await renderSignedIn()
		const user = userEvent.setup()
		await user.click(trigger())
		await user.click(trigger())
		expect(trigger()).toHaveAttribute('aria-expanded', 'false')
		expect(panel()).toBeNull()
	})

	it('closes on Escape and returns focus to the trigger', async () => {
		await renderSignedIn()
		const user = userEvent.setup()
		await user.click(trigger())
		await user.tab()
		await user.keyboard('{Escape}')
		expect(panel()).toBeNull()
		expect(trigger()).toHaveFocus()
	})

	it('closes on Escape WITHOUT stealing focus a control outside the menu already holds', async () => {
		stubFetch({ user: USER })
		renderWithRouter(
			<>
				<AuthIndicator />
				<button type="button">elsewhere</button>
			</>
		)
		await within(await findAccountStatus()).findByText(USER.email)
		const user = userEvent.setup()
		await user.click(trigger())
		screen.getByRole('button', { name: 'elsewhere' }).focus()
		await user.keyboard('{Escape}')
		expect(panel()).toBeNull()
		expect(screen.getByRole('button', { name: 'elsewhere' })).toHaveFocus()
	})

	it('closes on a press outside the menu, and not on a press inside the panel', async () => {
		stubFetch({ user: USER })
		renderWithRouter(
			<>
				<AuthIndicator />
				<button type="button">elsewhere</button>
			</>
		)
		await within(await findAccountStatus()).findByText(USER.email)
		const user = userEvent.setup()
		await user.click(trigger())

		// Pressing the non-interactive separator must not dismiss its own panel.
		await user.click((panel() as HTMLElement).querySelector('hr') as HTMLElement)
		expect(panel()).not.toBeNull()

		// The Premium pill is in the cluster but not the menu: that counts as outside.
		await user.click(within(accountStatus()).getByText(/^premium$/i))
		expect(panel()).toBeNull()

		await user.click(trigger())
		const elsewhere = screen.getByRole('button', { name: 'elsewhere' })
		await user.click(elsewhere)
		expect(panel()).toBeNull()
		// Light dismiss must not yank focus off what the user pressed.
		expect(elsewhere).toHaveFocus()
	})

	it('closes when Settings is chosen from another route, which navigates to /settings', async () => {
		stubFetch({ user: USER })
		const { router } = renderWithNavigableRouter()
		await within(await findAccountStatus()).findByText(USER.email)
		const user = userEvent.setup()
		await user.click(trigger())
		await user.click(within(panel() as HTMLElement).getByRole('link', { name: 'Settings' }))
		await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
		expect(panel()).toBeNull()
		expect(trigger()).toHaveAttribute('aria-expanded', 'false')
	})

	it('closes on navigation, and does not come back open after a sign-out and back in', async () => {
		let currentUser: unknown = USER
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input).includes('/api/auth/me')) {
				return Promise.resolve(new Response(JSON.stringify({ user: currentUser }), { status: 200 }))
			}
			return Promise.resolve(new Response('{}', { status: 200 }))
		}) as typeof global.fetch
		const { router } = renderWithNavigableRouter()
		await within(await findAccountStatus()).findByText(USER.email)
		const user = userEvent.setup()

		await user.click(trigger())
		expect(panel()).not.toBeNull()
		await act(async () => {
			await router.navigate({ to: '/forecasting' })
		})
		expect(trigger()).toHaveAttribute('aria-expanded', 'false')

		// The open state must not survive to a later sign-in.
		await user.click(trigger())
		currentUser = null
		await act(async () => {
			await router.navigate({ to: '/' })
		})
		await screen.findByRole('link', { name: /sign in/i })
		expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()

		currentUser = USER
		await act(async () => {
			await router.navigate({ to: '/forecasting' })
		})
		await within(await findAccountStatus()).findByText(USER.email)
		expect(trigger()).toHaveAttribute('aria-expanded', 'false')
	})

	describe('Sign out', () => {
		const assign = vi.fn()
		beforeEach(() => {
			vi.stubGlobal('location', { ...globalThis.location, assign })
		})
		afterEach(() => {
			vi.unstubAllGlobals()
		})

		it('signs out through the shared implementation: logout POST, then a document load to /', async () => {
			await renderSignedIn()
			const user = userEvent.setup()
			await user.click(trigger())
			await user.click(screen.getByRole('button', { name: 'Sign out' }))

			await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
			expect(signOut).toHaveBeenCalledTimes(1)
			expect(global.fetch).toHaveBeenCalledWith(
				'/api/auth/logout',
				expect.objectContaining({ method: 'POST' })
			)
		})

		// userEvent dispatches no click to a disabled element, so this proves the `disabled`
		// attribute; same-tick dedupe lives in signOut() itself.
		it('disables Sign out once activated, so a second click sends no second POST', async () => {
			stubFetch({ user: USER })
			const base = global.fetch
			global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
				String(input).includes('/api/auth/logout')
					? new Promise<Response>(() => {})
					: base(input, init)
			) as typeof global.fetch
			renderWithRouter(<AuthIndicator />)
			await within(await findAccountStatus()).findByText(USER.email)
			const user = userEvent.setup()
			await user.click(trigger())
			const button = screen.getByRole('button', { name: 'Sign out' })
			await user.click(button)
			await user.click(button)

			const logoutCalls = vi
				.mocked(global.fetch)
				.mock.calls.filter(([input]) => String(input).includes('/api/auth/logout'))
			expect(logoutCalls).toHaveLength(1)
			expect(button).toBeDisabled()
		})
	})

	// Class tokens: jsdom applies no Tailwind.
	it('carries the target-size and panel-placement tokens', async () => {
		await renderSignedIn()
		const user = userEvent.setup()
		// 28px at >= 640px; below 640px the strip grows to 45px to hold a 44px target.
		expect([...trigger().classList]).toEqual(
			expect.arrayContaining([
				'min-h-[1.75rem]',
				'px-2',
				'max-sm:min-h-[44px]',
				'max-sm:min-w-[44px]',
			])
		)
		expect([...trigger().classList]).not.toContain('min-h-[2rem]')
		expect([...trigger().classList]).not.toContain('min-h-[44px]')
		await user.click(trigger())
		const tokens = [...(panel() as HTMLElement).classList]
		expect(tokens).toEqual(
			expect.arrayContaining([
				'max-sm:inset-x-0',
				'max-sm:top-full',
				'sm:right-0',
				'sm:top-full',
				'z-40',
				'absolute',
				'overflow-y-auto',
				'bg-white',
				'dark:bg-gray-800',
			])
		)
		const signOutTokens = [
			...within(panel() as HTMLElement).getByRole('button', { name: 'Sign out' }).classList,
		]
		expect(signOutTokens).toEqual(
			expect.arrayContaining(['py-2', 'text-sm', 'max-sm:min-h-[44px]', 'max-sm:py-3'])
		)
		expect(signOutTokens).not.toContain('min-h-[44px]')
		expect(signOutTokens).toEqual(expect.arrayContaining(['max-sm:text-center', 'text-left']))
		expect(signOutTokens).not.toContain('text-center')
	})
})

/**
 * Class tokens only (jsdom applies no Tailwind), via classList membership, since
 * `max-sm:min-h-[44px]` contains `min-h-[44px]`.
 */
describe('AuthIndicator — phone tap targets', () => {
	const PHONE_TARGET_TOKENS = [
		'max-sm:inline-flex',
		'max-sm:min-h-[44px]',
		'max-sm:min-w-[44px]',
		'max-sm:items-center',
		'max-sm:justify-center',
	]
	const tokensOf = (el: Element) => [...el.classList]

	it.each(['Upgrade', 'Sign in'])('"%s" is a 44 x 44px target below 640px only', async (name) => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />)
		const link = await screen.findByRole('link', { name })
		expect(tokensOf(link)).toEqual(expect.arrayContaining(PHONE_TARGET_TOKENS))
		// Nothing unprefixed, so the >= 640px strip is unchanged.
		for (const token of ['min-h-[44px]', 'min-w-[44px]', 'inline-flex']) {
			expect(tokensOf(link), `${name} carries an unprefixed ${token}`).not.toContain(token)
		}
		expect(tokensOf(link)).toEqual(expect.arrayContaining(['px-3', 'py-1', 'sm:px-1.5']))
	})

	/** The status region's reserve: 44px of content + the row's 1px border = 45px. */
	function expectPhoneReserve(region: HTMLElement, state: string) {
		expect(tokensOf(region), `${state}: no 44px phone reserve`).toContain('max-sm:min-h-[44px]')
		expect(tokensOf(region), `${state}: the old 31px reserve`).not.toContain(
			'max-sm:min-h-[calc(2rem-1px)]'
		)
		expect(tokensOf(region)).toContain('min-h-[2rem]')
	}

	it('reserves the 45px phone strip signed out', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />)
		await screen.findByRole('link', { name: 'Sign in' })
		expectPhoneReserve(accountStatus(), 'signed out')
	})

	it('reserves the 45px phone strip signed in', async () => {
		stubFetch({ user: { userId: 'u', email: 'user@example.com', subscriptionStatus: 'free' } })
		renderWithRouter(<AuthIndicator />)
		await within(await findAccountStatus()).findByText('user@example.com')
		expectPhoneReserve(accountStatus(), 'signed in')
	})

	it('reserves the 45px phone strip while loading', async () => {
		stubFetchPending()
		renderWithRouter(<AuthIndicator />)
		const region = await findAccountStatus()
		// Positive control: this is the loading state.
		expect(region.querySelector('span[aria-hidden="true"]')).not.toBeNull()
		expectPhoneReserve(region, 'loading')
	})

	it('reserves the 45px phone strip on /login (the deliberately empty strip)', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />, { path: '/login' })
		const region = await findAccountStatus()
		await waitFor(() => expect(region.querySelector('span[aria-hidden="true"]')).toBeNull())
		expect(region.children).toHaveLength(0)
		expectPhoneReserve(region, '/login')
	})
})

/**
 * Navigation, so outside the live region: marked current on /settings, hidden on /login,
 * >= 640px only. jsdom has no layout, so size is asserted as class tokens.
 */
describe('AuthIndicator — the signed-out Settings gear', () => {
	const gear = () => screen.queryByRole('link', { name: 'Settings' })

	it.each(['/', '/income', '/pricing'])(
		'renders a gear link to /settings on %s, outside the live region',
		async (path) => {
			stubFetch({ user: null })
			const { container } = renderWithRouter(<AuthIndicator />, { path })
			await screen.findByRole('link', { name: /sign in/i })
			const link = gear()
			expect(link, `no Settings gear on ${path}`).not.toBeNull()
			expect(link).toHaveAttribute('href', '/settings')
			expect(link).toHaveAccessibleName('Settings')
			expect(link?.textContent).toBe('')
			expect(link?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
			expect(accountStatus().contains(link)).toBe(false)
			expect(container.querySelector('[data-auth-indicator]')?.contains(link)).toBe(true)
			expect([...(link as HTMLElement).classList]).toEqual(
				expect.arrayContaining(['h-7', 'w-7', 'shrink-0'])
			)
			expect([...(link as HTMLElement).classList], 'the gear shows on a phone').toContain(
				'max-sm:hidden'
			)
			expect([...(link as HTMLElement).classList]).not.toContain('sm:hidden')
			expect(link).not.toHaveAttribute('aria-current')
			// Hidden below 640px, so it gets no phone floor.
			expect([...(link as HTMLElement).classList]).not.toContain('max-sm:min-h-[44px]')
		}
	)

	it('marks the gear current on /settings rather than dropping it', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />, { path: '/settings' })
		await screen.findByRole('link', { name: /sign in/i })
		expect(gear()).toHaveAttribute('aria-current', 'page')
	})

	// Anti-vacuity: the strip is empty here, so resolution is proven by the region settling
	// with no children.
	it('renders no gear on /login, which keeps its empty strip', async () => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />, { path: '/login' })
		const indicator = await findAccountStatus()
		await waitFor(() => expect(indicator.children).toHaveLength(0))
		expect(gear()).toBeNull()
		expect(document.querySelector('a[href="/settings"]')).toBeNull()
	})

	it('renders no gear for a signed-in user (the account menu is their route)', async () => {
		stubFetch({ user: { userId: 'u', email: 'user@example.com', subscriptionStatus: 'free' } })
		renderWithRouter(<AuthIndicator />)
		await within(await findAccountStatus()).findByText('user@example.com')
		expect(gear()).toBeNull()
		expect(document.querySelector('a[href="/settings"]')).toBeNull()
	})

	it('renders no gear while the session is loading', async () => {
		stubFetchPending()
		renderWithRouter(<AuthIndicator />)
		// The region always renders; the loading placeholder is what proves this gate.
		const region = await findAccountStatus()
		expect(region.children).toHaveLength(1)
		expect(region.children[0]).toHaveAttribute('aria-hidden', 'true')
		expect(gear()).toBeNull()
	})

	// TanStack's active match is case-sensitive, but /Settings serves the page.
	it.each(['/Settings', '/SETTINGS'])('marks the gear current on %s too', async (path) => {
		stubFetch({ user: null })
		renderWithRouter(<AuthIndicator />, { path })
		await screen.findByRole('link', { name: /sign in/i })
		expect(gear()).toHaveAttribute('aria-current', 'page')
	})
})

/**
 * A client render leaves <noscript> empty in React 19, so this proves only that no live
 * second gear exists with JavaScript on; the server half is in the SSR test.
 */
describe('AuthIndicator — the signed-in JS-off Settings gear', () => {
	it('renders a <noscript> in the signed-in cluster, holding no live link', async () => {
		stubFetch({
			user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' },
		})
		const { container } = renderWithRouter(<AuthIndicator />, { path: '/income' })
		await screen.findByRole('button', { name: 'Account menu' })
		const row = container.querySelector('[data-auth-indicator]') as HTMLElement
		const noscripts = row.querySelectorAll(':scope > noscript')
		expect(noscripts, 'the signed-in cluster has no <noscript> gear').toHaveLength(1)
		expect(accountStatus().contains(noscripts[0] as Node)).toBe(false)
		// The panel is closed, so nothing links to /settings.
		expect(screen.queryAllByRole('link', { name: 'Settings' })).toHaveLength(0)
		expect(container.querySelector('a[href="/settings"]')).toBeNull()
	})

	it('renders no <noscript> gear for a signed-out visitor, who has the real one', async () => {
		stubFetch({ user: null })
		const { container } = renderWithRouter(<AuthIndicator />, { path: '/income' })
		await screen.findByRole('link', { name: /sign in/i })
		expect(container.querySelectorAll('noscript')).toHaveLength(0)
		expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(1)
	})
})
