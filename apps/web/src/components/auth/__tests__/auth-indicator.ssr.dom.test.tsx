import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router'
import { act } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionSeed } from '../../../context/session-seed'
import { SessionSeedProvider } from '../../../context/session-seed-provider'
import {
	getVerifiedSession,
	resetVerifiedSessionForTests,
} from '../../../lib/session/verifiedSession'
import { AuthIndicator } from '../auth-indicator'

// `router.load()` before `renderToString`, or the router emits an unresolved Suspense
// boundary and every assertion passes on nothing.

const SIGNED_OUT = {
	isAuthenticated: false,
	userId: null,
	email: null,
	subscriptionStatus: null,
} satisfies SessionSeed
const ENTITLED = {
	isAuthenticated: true,
	userId: 'u1',
	email: 'e2e-paid@example.test',
	subscriptionStatus: 'active',
} satisfies SessionSeed

/** Differs between server and client render: the designed-RED control. */
let renderingOnClient = false
function Mismatch() {
	return renderingOnClient ? <i>client</i> : <b>server</b>
}

async function makeRouter(seed: SessionSeed, path: string, withMismatch = false) {
	const rootRoute = createRootRoute({
		component: () => (
			<SessionSeedProvider seed={seed}>
				<AuthIndicator />
				{withMismatch && (
					<div>
						<Mismatch />
					</div>
				)}
			</SessionSeedProvider>
		),
	})
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: [path] }),
	})
	await router.load()
	return router
}

async function serverHtml(seed: SessionSeed, path: string) {
	const html = renderToString(<RouterProvider router={await makeRouter(seed, path)} />)
	const container = document.createElement('div')
	container.innerHTML = html
	const row = container.querySelector('[data-auth-indicator]')
	expect(row, 'the server HTML has no account row (unresolved router?)').not.toBeNull()
	return { html, row: row as HTMLElement }
}

beforeEach(() => {
	// The post-mount session fetch is never reached by `renderToString`; the
	// hydration test holds it open so the seeded state is what hydrates.
	vi.stubGlobal(
		'fetch',
		vi.fn(() => new Promise<Response>(() => {}))
	)
})
afterEach(() => {
	vi.unstubAllGlobals()
})

describe('AuthIndicator — server HTML, signed out (JS off)', () => {
	it.each(['/', '/income'])(
		'serves the Settings gear on %s as a real link outside the live region',
		async (path) => {
			const { row } = await serverHtml(SIGNED_OUT, path)
			const gear = row.querySelectorAll('a[href="/settings"]')
			expect(gear, `no server-rendered gear on ${path}`).toHaveLength(1)
			expect(gear[0]).toHaveAttribute('aria-label', 'Settings')
			expect(row.querySelector('[role="status"]')?.contains(gear[0] as Node)).toBe(false)
			expect(gear[0]?.closest('noscript')).toBeNull()
			expect([...(gear[0] as Element).classList]).toContain('max-sm:hidden')
		}
	)
})

describe('AuthIndicator — server HTML on /login', () => {
	it('serves no gear on /login, while / serves one (contrast)', async () => {
		const { row: onHome } = await serverHtml(SIGNED_OUT, '/')
		expect(onHome.querySelectorAll('a[href="/settings"]')).toHaveLength(1)
		const { row: onLogin } = await serverHtml(SIGNED_OUT, '/login')
		expect(
			onLogin.querySelector('a[href="/settings"]'),
			'the server sent a gear on /login'
		).toBeNull()
	})
})

describe('AuthIndicator — server HTML, signed in', () => {
	it('paints the account trigger collapsed in the first frame, with no panel', async () => {
		const { html, row } = await serverHtml(ENTITLED, '/')
		const trigger = row.querySelector('button[aria-label="Account menu"]')
		expect(trigger, 'the trigger is not in the server HTML').not.toBeNull()
		expect(trigger).toHaveAttribute('aria-expanded', 'false')
		expect(trigger).not.toHaveAttribute('aria-controls')
		expect(html).not.toContain('Sign out')
		expect(row.querySelector('[role="status"]')?.textContent).toContain('e2e-paid@example.test')
	})

	/**
	 * React 19 renders <noscript> children on the server only, and a parsed DOM holds them as
	 * text, so the check is on the HTML string.
	 */
	it('serves a signed-in visitor’s JS-off Settings gear inside <noscript>', async () => {
		const { html } = await serverHtml(ENTITLED, '/income')
		const noscripts = html.match(/<noscript>[\s\S]*?<\/noscript>/g) ?? []
		expect(noscripts, 'expected exactly one <noscript> in the cluster').toHaveLength(1)
		expect(noscripts[0]).toMatch(/<a [^>]*href="\/settings"/)
		expect(noscripts[0]).toMatch(/aria-label="Settings"/)
		// Token-bounded match on the anchor's class attribute, never a bare substring.
		const anchorClass = (noscripts[0] as string).match(/<a [^>]*class="([^"]*)"/)?.[1] ?? ''
		expect(anchorClass.split(/\s+/), 'the JS-off gear shows on a phone').toContain('max-sm:hidden')
		expect(html.replace(noscripts[0] as string, '')).not.toContain('href="/settings"')
	})
})

async function hydrateSignedIn(withMismatch: boolean) {
	renderingOnClient = false
	const container = document.createElement('div')
	container.innerHTML = renderToString(
		<RouterProvider router={await makeRouter(ENTITLED, '/income', withMismatch)} />
	)
	document.body.appendChild(container)
	renderingOnClient = true
	const clientRouter = await makeRouter(ENTITLED, '/income', withMismatch)

	const recoverable: string[] = []
	const consoleErrors: string[] = []
	const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		consoleErrors.push(args.map(String).join(' '))
	})
	let root: ReturnType<typeof hydrateRoot> | undefined
	await act(async () => {
		root = hydrateRoot(container, <RouterProvider router={clientRouter} />, {
			onRecoverableError: (error) => recoverable.push(String(error)),
		})
	})
	spy.mockRestore()
	renderingOnClient = false
	return {
		container,
		recoverable,
		consoleErrors,
		cleanup: () => {
			act(() => root?.unmount())
			container.remove()
		},
	}
}

describe('AuthIndicator — hydrating the signed-in cluster', () => {
	/**
	 * Designed RED: React 19 tolerates extra nodes directly under the hydration root, so this
	 * proves the harness can see a mismatch at all.
	 */
	it('reports a mismatch when the server and client trees differ (control)', async () => {
		const { recoverable, cleanup } = await hydrateSignedIn(true)
		try {
			expect(recoverable.length, 'the harness cannot see a hydration mismatch').toBeGreaterThan(0)
		} finally {
			cleanup()
		}
	})

	it('the <noscript> gear causes no hydration error and leaves no live link', async () => {
		const { container, recoverable, consoleErrors, cleanup } = await hydrateSignedIn(false)

		try {
			// Anti-vacuity: the cluster hydrated (React owns the trigger).
			const trigger = container.querySelector('button[aria-label="Account menu"]') as HTMLElement
			expect(trigger).not.toBeNull()
			expect(Object.keys(trigger).some((k) => k.startsWith('__reactFiber'))).toBe(true)

			expect(recoverable, `recoverable errors: ${recoverable.join(' | ')}`).toEqual([])
			expect(
				consoleErrors.filter((e) => /hydrat|did not match|mismatch/i.test(e)),
				'React reported a hydration mismatch'
			).toEqual([])
			expect(container.querySelector('a[href="/settings"]'), 'a live gear leaked').toBeNull()
		} finally {
			cleanup()
		}
	})
})

/**
 * The /login branch runs on server and client, so both must agree on the route. Nested
 * under a wrapper with a sibling: a mismatch directly under the root goes unreported.
 */
async function hydrateSignedOutAt(path: string, withMismatch: boolean) {
	renderingOnClient = false
	const container = document.createElement('div')
	const server = await makeRouter(SIGNED_OUT, path, withMismatch)
	container.innerHTML = `<div>${renderToString(
		<RouterProvider router={server} />
	)}<p>after</p></div>`
	document.body.appendChild(container)
	renderingOnClient = true
	const clientRouter = await makeRouter(SIGNED_OUT, path, withMismatch)

	const recoverable: string[] = []
	let root: ReturnType<typeof hydrateRoot> | undefined
	await act(async () => {
		root = hydrateRoot(
			container,
			<div>
				<RouterProvider router={clientRouter} />
				<p>after</p>
			</div>,
			{ onRecoverableError: (error) => recoverable.push(String(error)) }
		)
	})
	renderingOnClient = false
	return {
		container,
		recoverable,
		cleanup: () => {
			act(() => root?.unmount())
			container.remove()
		},
	}
}

describe('AuthIndicator — hydrating the signed-out strip on /login', () => {
	it('reports a mismatch when the server and client trees differ (control)', async () => {
		const { recoverable, cleanup } = await hydrateSignedOutAt('/login', true)
		try {
			expect(recoverable.length, 'the harness cannot see a hydration mismatch').toBeGreaterThan(0)
		} finally {
			cleanup()
		}
	})

	it('hydrates with no mismatch and offers no "Sign in" link on /login', async () => {
		const { container, recoverable, cleanup } = await hydrateSignedOutAt('/login', false)
		try {
			const row = container.querySelector('[data-auth-indicator]')
			expect(row, 'the account strip did not render').not.toBeNull()
			const region = row?.querySelector('[role="status"]')
			expect(region, 'the account status region did not render').not.toBeNull()

			expect(recoverable, `recoverable errors: ${recoverable.join(' | ')}`).toEqual([])
			expect(
				[...container.querySelectorAll('a')].filter((a) => /sign in/i.test(a.textContent ?? '')),
				'the strip offered "Sign in" on /login'
			).toEqual([])
		} finally {
			cleanup()
		}
	})

	it('offers "Sign in" on / (contrast: the branch is route-dependent)', async () => {
		const { container, recoverable, cleanup } = await hydrateSignedOutAt('/', false)
		try {
			expect(recoverable).toEqual([])
			const region = container.querySelector('[data-auth-indicator] [role="status"]')
			expect(
				[...(region?.querySelectorAll('a') ?? [])].some((a) => /sign in/i.test(a.textContent ?? ''))
			).toBe(true)
		} finally {
			cleanup()
		}
	})
})

/**
 * The verified-session store is a module singleton: a write during a server render would
 * leak one user's tier into the next request's nav.
 */
describe('AuthIndicator — a server render never writes the verified session', () => {
	afterEach(() => {
		resetVerifiedSessionForTests()
	})

	it.each([
		['signed out', SIGNED_OUT],
		['entitled', ENTITLED],
	] as const)('a %s server render leaves the store empty', async (_name, seed) => {
		// A fetch that WOULD answer at once, so any write path reached during the
		// render (or a microtask after it) has a definitive answer to write.
		const fetchMock = vi.fn(() =>
			Promise.resolve(new Response(JSON.stringify({ user: ENTITLED }), { status: 200 }))
		)
		vi.stubGlobal('fetch', fetchMock)
		const { html } = await serverHtml(seed, '/')
		expect(html).toContain('data-auth-indicator')
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(fetchMock, 'the server render asked /api/auth/me').not.toHaveBeenCalled()
		expect(getVerifiedSession()).toBeUndefined()
	})
})
