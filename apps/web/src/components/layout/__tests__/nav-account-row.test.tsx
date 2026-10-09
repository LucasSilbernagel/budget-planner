import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	act,
	fireEvent,
	render,
	renderWithRouter,
	screen,
	userEvent,
	waitFor,
	within,
} from '@/test/utils'

import {
	type SessionSeed,
	SessionSeedProvider,
	SIGNED_OUT_SEED,
} from '../../../context/session-seed'
import {
	getVerifiedSession,
	resetVerifiedSessionForTests,
} from '../../../lib/session/verifiedSession'
import { AuthIndicator } from '../../auth/auth-indicator'
import { GlobalNav, PREMIUM_NAV_ROUTES } from '../GlobalNav'

// Link counts are DOM presence, not reachability: jsdom has no closed-<details> rule and no
// stylesheet, so it sees every anchor. Don't "fix" them to the visible count.

const originalFetch = global.fetch

beforeEach(() => {
	vi.clearAllMocks()
	global.fetch = vi.fn((input: RequestInfo | URL) => {
		if (String(input).includes('/api/auth/me')) {
			return Promise.resolve(new Response(JSON.stringify({ user: null }), { status: 200 }))
		}
		return Promise.resolve(new Response('{}', { status: 200 }))
	}) as typeof global.fetch
})
afterEach(() => {
	global.fetch = originalFetch
	vi.restoreAllMocks()
	// `AuthIndicator` writes a module store the nav reads; reset it or a paid answer leaks.
	resetVerifiedSessionForTests()
})

function NavAccountRow() {
	return (
		<SessionSeedProvider
			seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
		>
			<div className="sm:border-b sm:bg-white">
				<div className="sm:mx-auto sm:flex sm:max-w-6xl sm:items-center sm:justify-between">
					<GlobalNav />
					<AuthIndicator />
				</div>
			</div>
		</SessionSeedProvider>
	)
}

describe('Nav + account row', () => {
	it('keeps exactly one Primary nav landmark holding exactly the six section links', async () => {
		renderWithRouter(<NavAccountRow />)

		const navs = await screen.findAllByRole('navigation', { name: /primary/i })
		expect(navs).toHaveLength(1)
		expect(within(navs[0]).getAllByRole('link')).toHaveLength(9)
	})

	it('puts the signed-out Settings gear in the account row, outside the nav and the live region', async () => {
		const { container } = renderWithRouter(<NavAccountRow />)

		const nav = await screen.findByRole('navigation', { name: /primary/i })
		await screen.findByRole('link', { name: /sign in/i })
		const row = container.querySelector('[data-auth-indicator]') as HTMLElement
		expect(row, 'the account row did not render').not.toBeNull()
		const gear = within(row).getByRole('link', { name: 'Settings' })

		expect(gear).toHaveAttribute('href', '/settings')
		expect(nav.contains(gear), 'the Settings gear was folded into <nav>').toBe(false)
		expect([...gear.classList], 'the gear shows on a phone too').toContain('max-sm:hidden')
		const navSettings = nav.querySelectorAll('a[href="/settings"]')
		expect(navSettings, 'the nav holds more than its phone-only Settings row').toHaveLength(1)
		const navRow = navSettings[0]?.closest('li') as HTMLElement
		expect(
			navRow.closest('details > ul'),
			'the nav Settings link is not a sheet row'
		).not.toBeNull()
		expect([...navRow.classList], 'the nav Settings row shows at >= 640px').toContain('sm:hidden')
		const status = screen.getByRole('status', { name: /account status/i })
		expect(status.contains(gear), 'the Settings gear is inside the live region').toBe(false)
		expect(gear.closest('[data-auth-indicator]')).not.toBeNull()
	})

	it('renders the "Sign in" affordance OUTSIDE the nav landmark — sibling, not descendant', async () => {
		renderWithRouter(<NavAccountRow />)

		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const signIn = await screen.findByRole('link', { name: /sign in/i })

		expect(signIn).toHaveAttribute('href', '/login')
		expect(nav.contains(signIn)).toBe(false)
		const status = screen.getByRole('status', { name: /account status/i })
		expect(status.contains(signIn)).toBe(true)
	})

	it('keeps the "Sign in" affordance OUT of the element that BECOMES the mobile fixed-bottom bar (crowding guard)', async () => {
		renderWithRouter(<NavAccountRow />)

		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const signIn = await screen.findByRole('link', { name: /sign in/i })

		// Pins `max-sm:fixed`: the landmark excluding Sign-in is the same element as the mobile bar.
		expect(nav.className.split(/\s+/), 'this nav is not the mobile bottom bar').toContain(
			'max-sm:fixed'
		)
		expect(within(nav).getAllByRole('link')).toHaveLength(9)
		expect(nav.contains(signIn)).toBe(false)
		const status = screen.getByRole('status', { name: /account status/i })
		expect(status.contains(signIn)).toBe(true)
	})

	it('keeps the "Sign in" affordance OUT of the mobile "More" sheet too', async () => {
		renderWithRouter(<NavAccountRow />)

		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const signIn = await screen.findByRole('link', { name: /sign in/i })

		const lists = nav.querySelectorAll('ul')
		expect(lists, 'expected the outer bar list and the nested sheet list').toHaveLength(2)
		const sheet = [...lists][1]

		expect(sheet.contains(signIn), 'Sign in was folded into the More sheet').toBe(false)
		expect(
			[...sheet.querySelectorAll('a')].map((a) => a.getAttribute('href')),
			'the More sheet holds something other than its two destinations and Settings'
		).toEqual(['/balance', '/retirement', '/settings'])
	})
})

describe('Nav + account row, signed in', () => {
	const USER = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' as const }

	it('keeps the account menu and its Sign out out of the nav and out of the More sheet', async () => {
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input).includes('/api/auth/me')) {
				return Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))
			}
			return Promise.resolve(new Response('{}', { status: 200 }))
		}) as typeof global.fetch
		const user = userEvent.setup()
		renderWithRouter(
			<SessionSeedProvider seed={{ isAuthenticated: true, ...USER }}>
				<div className="sm:mx-auto sm:flex sm:max-w-6xl sm:items-center sm:justify-between">
					<GlobalNav />
					<AuthIndicator />
				</div>
			</SessionSeedProvider>
		)

		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const trigger = await screen.findByRole('button', { name: 'Account menu' })
		await user.click(trigger)
		const signOut = screen.getByRole('button', { name: 'Sign out' })
		// Scoped to the panel: the nav's phone-only Settings row has the same name.
		const accountPanel = signOut.parentElement as HTMLElement
		const settings = within(accountPanel).getByRole('link', { name: 'Settings' })

		expect(nav.contains(trigger), 'the account menu trigger was folded into <nav>').toBe(false)
		expect(nav.contains(settings), 'the menu’s Settings link was folded into <nav>').toBe(false)
		expect(nav.contains(signOut), 'Sign out was folded into <nav>').toBe(false)
		const lists = [...nav.querySelectorAll('ul')]
		expect(lists, 'expected the bar list and the nested More sheet').toHaveLength(2)
		expect(lists[1].contains(signOut), 'Sign out was folded into the More sheet').toBe(false)
		expect(within(nav).getAllByRole('link')).toHaveLength(9)
		// Zero: More is a <summary>, which has no role in testing-library.
		expect(within(nav).queryAllByRole('button')).toHaveLength(0)

		// And outside the live region: a control there announces spuriously on every navigation.
		const status = screen.getByRole('status', { name: /account status/i })
		expect(status.contains(trigger)).toBe(false)
		expect(status.contains(signOut)).toBe(false)
		expect(status.contains(settings)).toBe(false)
		// Two in the document: the panel row (`max-sm:hidden`) and the nav's sheet row (`sm:hidden`).
		const all = [...document.querySelectorAll('a[href="/settings"]')]
		expect(all).toHaveLength(2)
		expect(all).toContain(settings)
		expect([...settings.classList]).toContain('max-sm:hidden')
		const navRow = all.find((a) => nav.contains(a))?.closest('li') as HTMLElement
		expect(navRow, 'the nav has no Settings row').toBeTruthy()
		expect([...navRow.classList]).toContain('sm:hidden')
	})
})

describe('Nav + account row, two disclosures', () => {
	const FREE_USER = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' }

	function renderSignedIn(subscriptionStatus: 'free' | 'active') {
		const user = { ...FREE_USER, subscriptionStatus }
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input).includes('/api/auth/me')) {
				return Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))
			}
			return Promise.resolve(new Response('{}', { status: 200 }))
		}) as typeof global.fetch
		renderWithRouter(
			<SessionSeedProvider seed={{ isAuthenticated: true, ...user }}>
				<div className="sm:mx-auto sm:flex sm:max-w-6xl sm:items-center sm:justify-between">
					<GlobalNav />
					<AuthIndicator />
				</div>
			</SessionSeedProvider>
		)
	}

	/**
	 * user-event doesn't focus a <summary> on mousedown (a browser does), so the browser order
	 * is reproduced by hand.
	 */
	const pressSummary = async () => {
		const { summary } = more()
		await act(async () => {
			fireEvent.pointerDown(summary)
			fireEvent.mouseDown(summary)
			summary.focus()
			fireEvent.pointerUp(summary)
			fireEvent.mouseUp(summary)
			fireEvent.click(summary)
		})
	}

	const more = () => {
		const nav = screen.getByRole('navigation', { name: /primary/i })
		return {
			details: nav.querySelector('details') as HTMLDetailsElement,
			summary: nav.querySelector('details > summary') as HTMLElement,
			panel: nav.querySelector('details > ul') as HTMLElement,
		}
	}

	it('pressing one trigger closes the other, in both orders, and focus lands on the pressed one', async () => {
		renderSignedIn('free')
		const user = userEvent.setup()
		const trigger = await screen.findByRole('button', { name: 'Account menu' })

		await pressSummary()
		await waitFor(() => expect(more().details.open).toBe(true))
		await user.click(trigger)
		await waitFor(() => expect(more().details.open, 'More stayed open').toBe(false))
		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		expect(trigger).toHaveFocus()

		await pressSummary()
		await waitFor(() =>
			expect(trigger, 'the account menu stayed open').toHaveAttribute('aria-expanded', 'false')
		)
		expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
		await waitFor(() => expect(more().details.open, 'More did not open').toBe(true))
		expect(more().summary).toHaveFocus()
	})

	/** A keyboard user can Tab past the open nav panel, so both can be open; one Escape closes both. */
	it('by keyboard both can be open at once, and ONE Escape closes both with focus on the account trigger', async () => {
		renderSignedIn('free')
		const user = userEvent.setup()
		const trigger = await screen.findByRole('button', { name: 'Account menu' })

		fireEvent.click(more().summary)
		await waitFor(() => expect(more().details.open).toBe(true))
		trigger.focus()
		await user.keyboard('{Enter}')
		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		expect(more().details.open, 'the keyboard case this test is about did not arise').toBe(true)

		await user.keyboard('{Escape}')
		expect(trigger).toHaveAttribute('aria-expanded', 'false')
		await waitFor(() => expect(more().details.open, 'More stayed open after Escape').toBe(false))
		expect(trigger, 'the nav yanked focus to More').toHaveFocus()
	})

	it('a paid user’s four premium routes stay one press away with the account menu open', async () => {
		renderSignedIn('active')
		const user = userEvent.setup()
		const trigger = await screen.findByRole('button', { name: 'Account menu' })

		await user.click(trigger)
		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		await pressSummary()
		await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
		await waitFor(() => expect(more().details.open).toBe(true))

		for (const [label, href] of [
			['Forecasting', '/forecasting'],
			['Profiles', '/profiles'],
			['Financial Summary', '/financial-summary'],
			['Categories', '/categories'],
		] as const) {
			const link = within(more().panel).getByRole('link', { name: label })
			expect(link, `${label} is not reachable in the open panel`).toBeVisible()
			expect(link).toHaveAttribute('href', href)
		}
	})
})

// jsdom sees every route at once, so the per-width rule is pinned as complementary tokens.
// React 19 renders <noscript> children on the server only, so that gear comes from server HTML.
describe('Nav + account row, the per-width Settings route', () => {
	const FREE = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' as const }
	const PAID = { ...FREE, subscriptionStatus: 'active' as const }
	type Me = { userId: string; email: string; subscriptionStatus: 'free' | 'active' }

	function stubMe(user: Me | null | 'pending') {
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input).includes('/api/auth/me')) {
				if (user === 'pending') return new Promise<Response>(() => {})
				return Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))
			}
			return Promise.resolve(new Response('{}', { status: 200 }))
		}) as typeof global.fetch
	}

	function Row({ seed }: { seed: SessionSeed | null }) {
		return (
			<SessionSeedProvider seed={seed}>
				<div className="sm:mx-auto sm:flex sm:max-w-6xl sm:items-center sm:justify-between">
					<GlobalNav />
					<AuthIndicator />
				</div>
			</SessionSeedProvider>
		)
	}

	async function serverNoscriptRoutes(seed: SessionSeed | null, path: string) {
		const router = createRouter({
			routeTree: createRootRoute({ component: () => <Row seed={seed} /> }),
			history: createMemoryHistory({ initialEntries: [path] }),
		})
		await router.load()
		const html = renderToString(<RouterProvider router={router} />)
		expect(html, 'the server HTML has no nav (unresolved router?)').toContain(
			'aria-label="Primary"'
		)
		const routes: Element[] = []
		for (const match of html.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)) {
			const template = document.createElement('template')
			template.innerHTML = match[1] as string
			routes.push(...template.content.querySelectorAll('a[href="/settings"]'))
		}
		return routes
	}

	const widthScope = (a: Element): Element => a.closest('li[data-nav-settings]') ?? a
	const has = (el: Element, token: string) => el.classList.contains(token)

	const CASES: readonly {
		name: string
		seed: SessionSeed | null
		me: Me | null | 'pending'
		path: string
		openPanel: boolean
		desktopRoute: boolean
	}[] = [
		{
			name: 'signed out',
			seed: SIGNED_OUT_SEED,
			me: null,
			path: '/',
			openPanel: false,
			desktopRoute: true,
		},
		{
			name: 'signed out on /login',
			seed: SIGNED_OUT_SEED,
			me: null,
			path: '/login',
			openPanel: false,
			desktopRoute: false,
		},
		{
			name: 'signed in, free (panel open)',
			seed: { isAuthenticated: true, ...FREE },
			me: FREE,
			path: '/',
			openPanel: true,
			desktopRoute: true,
		},
		{
			name: 'signed in, entitled (panel open)',
			seed: { isAuthenticated: true, ...PAID },
			me: PAID,
			path: '/',
			openPanel: true,
			desktopRoute: true,
		},
		{
			name: 'a null seed, loading',
			seed: null,
			me: 'pending',
			path: '/',
			openPanel: false,
			desktopRoute: false,
		},
	]

	it.each(CASES)(
		'a phone has exactly one Settings route and a desktop keeps its own: $name',
		async ({ seed, me, path, openPanel, desktopRoute }) => {
			stubMe(me)
			renderWithRouter(<Row seed={seed} />, { path })
			const nav = await screen.findByRole('navigation', { name: /primary/i })
			if (openPanel) {
				await userEvent.setup().click(await screen.findByRole('button', { name: 'Account menu' }))
				expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
			} else if (me === null && path === '/') {
				await screen.findByRole('link', { name: /sign in/i })
			} else {
				await screen.findByRole('status', { name: /account status/i })
			}

			const routes = [
				...document.querySelectorAll('a[href="/settings"]'),
				...(seed?.isAuthenticated ? await serverNoscriptRoutes(seed, path) : []),
			]
			const phone = routes.filter((a) => has(widthScope(a), 'sm:hidden'))
			const desktop = routes.filter((a) => has(widthScope(a), 'max-sm:hidden'))

			expect(phone, 'a phone has no Settings route, or more than one').toHaveLength(1)
			expect(nav.contains(phone[0] as Node), 'the phone route is not the nav row').toBe(true)
			for (const a of routes) {
				if (a === phone[0]) continue
				expect(
					desktop.includes(a),
					`a /settings route outside the nav shows on a phone: ${a.outerHTML}`
				).toBe(true)
				expect(has(widthScope(a), 'sm:hidden'), 'a route carries both tokens').toBe(false)
			}
			expect(desktop.length > 0, 'the >= 640px route set is wrong for this session').toBe(
				desktopRoute
			)
			if (seed?.isAuthenticated) {
				expect(desktop).toHaveLength(2)
			}
		}
	)
})

describe('Nav + account row, the nav follows the verified session', () => {
	const PAID = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' }
	type Me = typeof PAID

	function stubMe(answer: () => Response | Promise<Response>, delayMs = 0) {
		const me = vi.fn(answer)
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input).includes('/api/auth/me')) {
				if (delayMs === 0) return Promise.resolve(me())
				return new Promise<Response>((resolve) => setTimeout(() => resolve(me()), delayMs))
			}
			return Promise.resolve(new Response('{}', { status: 200 }))
		}) as typeof global.fetch
		return me
	}
	const meIs = (user: Me | null) => () => new Response(JSON.stringify({ user }), { status: 200 })

	/** Held so the first paint can be asserted: a zero-delay stub can resolve before `findByRole` returns. */
	function held(answer: () => Response) {
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const respond = async () => {
			await gate
			return answer()
		}
		return { respond, release: () => release() }
	}

	function Row({ seed }: { seed: SessionSeed | null }) {
		return (
			<SessionSeedProvider seed={seed}>
				<div className="sm:mx-auto sm:flex sm:max-w-6xl sm:items-center sm:justify-between">
					<GlobalNav />
					<AuthIndicator />
				</div>
			</SessionSeedProvider>
		)
	}

	function renderNavigable(seed: SessionSeed | null, path = '/') {
		const rootRoute = createRootRoute({ component: () => <Row seed={seed} /> })
		const router = createRouter({
			routeTree: rootRoute.addChildren(
				['/', '/income', '/login'].map((p) =>
					createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null })
				)
			),
			history: createMemoryHistory({ initialEntries: [path] }),
		})
		const result = render(<RouterProvider router={router} />)
		return { router, ...result }
	}

	const premiumHrefsInNav = () => {
		const nav = screen.getByRole('navigation', { name: /primary/i })
		return PREMIUM_NAV_ROUTES.filter((href) => nav.querySelector(`a[href="${href}"]`) !== null)
	}
	const premiumMarker = () =>
		within(screen.getByRole('status', { name: /account status/i })).queryByText('Premium', {
			exact: true,
		})

	it('names the four premium destinations (guards the assertions below against a vacuous list)', () => {
		expect([...PREMIUM_NAV_ROUTES].sort()).toEqual(
			['/categories', '/financial-summary', '/forecasting', '/profiles'].sort()
		)
	})

	it.each([
		{ name: 'a signed-out seed (the C1 cached document)', seed: SIGNED_OUT_SEED, delayMs: 0 },
		{ name: 'a null seed (the C3 resolver error)', seed: null, delayMs: 0 },
		{ name: 'a signed-out seed, slow answer', seed: SIGNED_OUT_SEED, delayMs: 50 },
		{ name: 'a null seed, slow answer', seed: null, delayMs: 50 },
	] as const)(
		'$name + a premium /api/auth/me: the premium destinations appear',
		async ({ seed, delayMs }) => {
			const answer = held(meIs(PAID))
			stubMe(answer.respond, delayMs)
			renderNavigable(seed)

			await screen.findByRole('navigation', { name: /primary/i })
			expect(premiumHrefsInNav()).toEqual([])
			answer.release()
			await waitFor(() => expect(premiumMarker()).not.toBeNull())
			expect(premiumHrefsInNav()).toEqual([...PREMIUM_NAV_ROUTES])
		}
	)

	// A MutationObserver callback runs at every microtask checkpoint, so any in-between state is recorded.
	it.each([
		{ name: 'signed-out seed', seed: SIGNED_OUT_SEED },
		{ name: 'null seed', seed: null },
	] as const)(
		'$name: the Premium marker and the premium destinations land together',
		async ({ seed }) => {
			const answer = held(meIs(PAID))
			stubMe(answer.respond)
			const { container } = renderNavigable(seed)
			await screen.findByRole('navigation', { name: /primary/i })
			const split: string[] = []
			const observer = new MutationObserver(() => {
				const marker = premiumMarker() !== null
				const hrefs = premiumHrefsInNav().length
				if (marker !== (hrefs === PREMIUM_NAV_ROUTES.length)) {
					split.push(`marker=${marker} premiumHrefs=${hrefs}`)
				}
			})
			observer.observe(container, { childList: true, subtree: true, characterData: true })
			answer.release()
			await waitFor(() => expect(premiumMarker()).not.toBeNull())
			observer.disconnect()
			expect(premiumHrefsInNav()).toEqual([...PREMIUM_NAV_ROUTES])
			expect(split, 'the header showed Premium with the free nav (or the reverse)').toEqual([])
		}
	)

	it('a tab open from before sign-in (C2): the premium answer arrives on a client navigation', async () => {
		let signedIn = false
		const me = stubMe(() => meIs(signedIn ? PAID : null)())
		const { router } = renderNavigable(SIGNED_OUT_SEED)

		await screen.findByRole('link', { name: /sign in/i })
		await waitFor(() => expect(me).toHaveBeenCalledTimes(1))
		expect(premiumHrefsInNav()).toEqual([])

		signedIn = true
		await act(async () => {
			await router.navigate({ to: '/income' })
		})
		await waitFor(() => expect(premiumMarker()).not.toBeNull())
		expect(me).toHaveBeenCalledTimes(2)
		expect(premiumHrefsInNav()).toEqual([...PREMIUM_NAV_ROUTES])
	})

	const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 30)))

	const ENTITLED_SEED: SessionSeed = { isAuthenticated: true, ...PAID } as SessionSeed

	it.each([
		{ name: 'a 503', answer: () => new Response('{}', { status: 503 }) },
		{
			name: 'a network error',
			answer: () => {
				throw new TypeError('Failed to fetch')
			},
		},
		{ name: 'a 200 that is not JSON', answer: () => new Response('<html>', { status: 200 }) },
		{ name: 'a 200 with no user key', answer: () => new Response('{}', { status: 200 }) },
		{
			name: 'a 200 whose user has no email',
			answer: () => new Response(JSON.stringify({ user: { ...PAID, email: '' } }), { status: 200 }),
		},
	])(
		'$name is not an answer: the nav keeps what the seed gave it, in both tiers',
		async ({ answer }) => {
			for (const [seed, expected] of [
				[SIGNED_OUT_SEED, []],
				[null, []],
				[ENTITLED_SEED, [...PREMIUM_NAV_ROUTES]],
			] as const) {
				const me = stubMe(answer)
				const { unmount } = renderNavigable(seed)
				await waitFor(() => expect(me).toHaveBeenCalledTimes(1))
				await settle()
				await screen.findByRole('link', { name: /sign in/i })
				expect(getVerifiedSession(), 'an unknown answer was recorded').toBeUndefined()
				expect(premiumHrefsInNav()).toEqual(expected)
				unmount()
				resetVerifiedSessionForTests()
			}
		}
	)

	it.each(['free', 'past_due', 'canceled'])(
		'a definitive %s answer over a signed-out seed never shows the premium destinations',
		async (status) => {
			const me = stubMe(meIs({ ...PAID, subscriptionStatus: status }))
			renderNavigable(SIGNED_OUT_SEED)
			await screen.findByRole('button', { name: 'Account menu' })
			expect(me).toHaveBeenCalledTimes(1)
			expect(getVerifiedSession()?.subscriptionStatus).toBe(status)
			expect(premiumMarker()).toBeNull()
			expect(premiumHrefsInNav()).toEqual([])
		}
	)

	it.each([
		{ name: 'signed out', user: null },
		{ name: 'free', user: { ...PAID, subscriptionStatus: 'free' } },
	])(
		'an entitled seed + a definitive $name answer: the premium destinations go',
		async ({ user }) => {
			const answer = held(meIs(user))
			stubMe(answer.respond)
			renderNavigable(ENTITLED_SEED)
			await screen.findByRole('navigation', { name: /primary/i })
			expect(premiumHrefsInNav(), 'first paint is the seed').toEqual([...PREMIUM_NAV_ROUTES])
			answer.release()
			await waitFor(() => expect(premiumHrefsInNav()).toEqual([]))
			expect(premiumMarker()).toBeNull()
		}
	)

	// An unknown answer after a definitive one keeps the last definitive answer (store not cleared).
	it('a definitive premium answer, then a 503 on the next navigation: the nav keeps the last answer', async () => {
		let fail = false
		const me = stubMe(() => (fail ? new Response('{}', { status: 503 }) : meIs(PAID)()))
		const { router } = renderNavigable(SIGNED_OUT_SEED)
		await waitFor(() => expect(premiumMarker()).not.toBeNull())
		expect(premiumHrefsInNav()).toEqual([...PREMIUM_NAV_ROUTES])

		fail = true
		await act(async () => {
			await router.navigate({ to: '/income' })
		})
		await waitFor(() => expect(me).toHaveBeenCalledTimes(2))
		await screen.findByRole('link', { name: /sign in/i })
		expect(getVerifiedSession()?.subscriptionStatus).toBe('active')
		expect(premiumHrefsInNav()).toEqual([...PREMIUM_NAV_ROUTES])
	})

	it('a null seed with no answer yet is the free nav', async () => {
		stubMe(() => new Promise<Response>(() => {}))
		renderNavigable(null)
		await screen.findByRole('navigation', { name: /primary/i })
		await settle()
		expect(getVerifiedSession()).toBeUndefined()
		expect(premiumHrefsInNav()).toEqual([])
	})

	it.each([
		{ name: 'paid seed + paid answer', seed: ENTITLED_SEED, user: PAID, premium: 4 },
		{
			name: 'free seed + free answer',
			seed: { isAuthenticated: true, ...PAID, subscriptionStatus: 'free' } as SessionSeed,
			user: { ...PAID, subscriptionStatus: 'free' },
			premium: 0,
		},
		{ name: 'signed-out seed + signed-out answer', seed: SIGNED_OUT_SEED, user: null, premium: 0 },
	])(
		'$name: no anchor is added or removed over the fetch (the nav re-renders, its DOM does not change)',
		async ({ seed, user, premium }) => {
			const answer = held(meIs(user as Me | null))
			const me = stubMe(answer.respond)
			renderNavigable(seed)
			const nav = await screen.findByRole('navigation', { name: /primary/i })
			const before = premiumHrefsInNav()
			expect(before).toHaveLength(premium)

			const anchorChanges: string[] = []
			const observer = new MutationObserver((records) => {
				for (const r of records) {
					for (const n of [...r.addedNodes, ...r.removedNodes]) {
						if (n instanceof Element && (n.matches('a') || n.querySelector('a'))) {
							anchorChanges.push(n.outerHTML.slice(0, 80))
						}
					}
				}
			})
			observer.observe(nav, { childList: true, subtree: true })
			answer.release()
			await waitFor(() => expect(me).toHaveBeenCalledTimes(1))
			await settle()
			expect(getVerifiedSession(), 'the answer never reached the store').toBeDefined()
			observer.disconnect()

			expect(anchorChanges, 'the nav flipped although seed and answer agree').toEqual([])
			expect(premiumHrefsInNav()).toEqual(before)
		}
	)
})
