import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { act, fireEvent, render, renderWithRouter, screen, userEvent, waitFor } from '@/test/utils'
import { GlobalNav } from '../GlobalNav'

// jsdom has no PointerEvent; fireEvent dispatches a plain Event, which is enough because
// the nav's handlers read only `event.target`.

const NAV = 'nav[aria-label="Primary"]'

function parts() {
	const nav = document.querySelector(NAV) as HTMLElement
	const details = nav.querySelector('details') as HTMLDetailsElement
	const summary = nav.querySelector('details > summary') as HTMLElement
	const panel = nav.querySelector('details > ul') as HTMLElement
	expect(details, 'no More <details>').not.toBeNull()
	expect(summary, 'no More <summary>').not.toBeNull()
	expect(panel, 'no More panel').not.toBeNull()
	return { nav, details, summary, panel }
}

// Real child routes so a navigation changes the pathname; `renderWithRouter` only seeds one.
function renderNavInApp(path = '/') {
	// jsdom has no `window.scrollTo`; TanStack's scroll restoration calls it.
	window.scrollTo = (() => {}) as typeof window.scrollTo
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<GlobalNav />
				<main>
					<Outlet />
					<button type="button">Page action</button>
					<p data-testid="inert">Inert page copy</p>
				</main>
			</>
		),
	})
	const children = ['/', '/income', '/expenses', '/savings', '/balance', '/retirement'].map((p) =>
		createRoute({ getParentRoute: () => rootRoute, path: p, component: () => <div>{p}</div> })
	)
	const router = createRouter({
		routeTree: rootRoute.addChildren(children),
		history: createMemoryHistory({ initialEntries: [path] }),
	})
	render(<RouterProvider router={router} />)
	return { router }
}

async function openWithClick() {
	const { details, summary } = parts()
	fireEvent.click(summary)
	await waitFor(() => expect(details.open, 'More did not open').toBe(true))
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('GlobalNav — light dismiss', () => {
	it('an outside press on a FOCUSABLE element closes it without stealing its focus', async () => {
		renderNavInApp()
		await screen.findByRole('navigation', { name: /primary/i })
		const user = userEvent.setup()
		await user.click(parts().summary)
		await waitFor(() => expect(parts().details.open).toBe(true))

		const pageAction = screen.getByRole('button', { name: 'Page action' })
		await user.click(pageAction)

		await waitFor(() =>
			expect(parts().details.open, 'the outside press did not dismiss').toBe(false)
		)
		expect(pageAction, 'dismissal stole focus from the element the user pressed').toHaveFocus()
	})

	it('an outside press on inert content closes it and returns focus to the trigger', async () => {
		renderNavInApp()
		await screen.findByRole('navigation', { name: /primary/i })
		const user = userEvent.setup()
		await user.click(parts().summary)
		await waitFor(() => expect(parts().details.open).toBe(true))

		await user.click(screen.getByTestId('inert'))

		await waitFor(() =>
			expect(parts().details.open, 'the outside press did not dismiss').toBe(false)
		)
		// Pressing non-focusable content blurs to <body>; the trigger reclaims it.
		expect(parts().summary, 'focus was left orphaned').toHaveFocus()
	})

	it('a press that starts outside and releases INSIDE the nav does not dismiss it', async () => {
		renderNavInApp()
		await screen.findByRole('navigation', { name: /primary/i })
		await openWithClick()
		const { details, panel } = parts()

		fireEvent.pointerDown(screen.getByTestId('inert'))
		fireEvent.pointerUp(panel)

		await act(async () => {})
		expect(details.open, 'a release inside the nav dismissed the panel').toBe(true)
	})

	it('a press that starts INSIDE the panel and releases outside does not dismiss it', async () => {
		renderNavInApp()
		await screen.findByRole('navigation', { name: /primary/i })
		await openWithClick()
		const { details, panel } = parts()

		fireEvent.pointerDown(panel)
		fireEvent.pointerUp(screen.getByTestId('inert'))

		await act(async () => {})
		expect(details.open, 'a press that began inside dismissed the panel').toBe(true)
	})

	it('a cancelled outside gesture does not arm the next pointerup', async () => {
		renderNavInApp()
		await screen.findByRole('navigation', { name: /primary/i })
		await openWithClick()
		const { details } = parts()
		const outside = screen.getByTestId('inert')

		// A touch that turned into a scroll: pointerdown, pointercancel, no pointerup.
		fireEvent.pointerDown(outside)
		fireEvent.pointerCancel(outside)
		fireEvent.pointerUp(outside)

		await act(async () => {})
		expect(details.open, 'a cancelled gesture left the outside-press flag armed').toBe(true)
	})

	// Left native, the DOM opens at once but state follows only on the async `toggle` task,
	// so a press in between is lost.
	it('an outside press in the SAME task as the opening click still dismisses', async () => {
		renderNavInApp()
		await screen.findByRole('navigation', { name: /primary/i })
		const { details, summary } = parts()
		const outside = screen.getByTestId('inert')

		let openWhenPressed = false
		await act(async () => {
			summary.click()
			await Promise.resolve()
			openWhenPressed = details.open
			fireEvent.pointerDown(outside)
			fireEvent.pointerUp(outside)
		})

		expect(openWhenPressed, 'the panel was not open when the outside press arrived').toBe(true)
		await waitFor(() =>
			expect(details.open, 'an outside press right after opening was ignored').toBe(false)
		)
	})
})

describe('GlobalNav — closes on any navigation', () => {
	it('a pathname change from outside the panel closes it, and the trigger is not lit', async () => {
		const { router } = renderNavInApp('/')
		await screen.findByRole('navigation', { name: /primary/i })
		await openWithClick()

		await act(async () => {
			await router.navigate({ to: '/income' })
		})

		expect(router.state.location.pathname).toBe('/income')
		expect(parts().details.open, 'the panel survived a navigation').toBe(false)
		expect(parts().summary.className, 'More is lit on a route it does not own').not.toMatch(
			/\bbg-green-50\b/
		)
	})
})

describe('GlobalNav — the free More closes when the window widens into lg', () => {
	/** jsdom has no `matchMedia`, and the nav skips its listener without one. */
	function stubMatchMedia() {
		const listeners = new Set<(event: { matches: boolean }) => void>()
		const mql = {
			matches: false,
			addEventListener: (_: string, cb: (event: { matches: boolean }) => void) => listeners.add(cb),
			removeEventListener: (_: string, cb: (event: { matches: boolean }) => void) =>
				listeners.delete(cb),
		}
		const matchMedia = vi.fn(() => mql)
		vi.stubGlobal('matchMedia', matchMedia)
		return {
			matchMedia,
			listenerCount: () => listeners.size,
			cross: (matches: boolean) =>
				act(() => {
					mql.matches = matches
					for (const cb of listeners) cb({ matches })
				}),
		}
	}

	it('closes an open free More on crossing into lg, and it stays closed back below', async () => {
		const media = stubMatchMedia()
		renderWithRouter(<GlobalNav />)
		await screen.findByRole('navigation', { name: /primary/i })
		// Anti-vacuity: the nav really subscribed.
		expect(media.listenerCount(), 'the nav never listened for lg').toBe(1)
		// The stub answers any query, so pin the query itself.
		expect(media.matchMedia).toHaveBeenCalledWith('(min-width: 1024px)')
		await openWithClick()

		media.cross(true)
		await waitFor(() => expect(parts().details.open, 'More stayed open across lg').toBe(false))

		media.cross(false)
		await act(async () => {})
		expect(parts().details.open, 'More re-appeared open below lg').toBe(false)
	})
})

describe('GlobalNav — the lg row copies mark "you are here"', () => {
	it.each([
		['Balances', '/balance'],
		['Retirement', '/retirement'],
	])('the %s row anchor is current on %s, and no other anchor is', async (label, path) => {
		renderWithRouter(<GlobalNav />, { path })
		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const row = nav.querySelector<HTMLAnchorElement>(
			`:scope > ul > li[data-nav-promoted][data-nav-path="${path}"] > a`
		)
		expect(row, `no ${label} row copy`).not.toBeNull()
		await waitFor(() => expect(row).toHaveAttribute('aria-current', 'page'))
		expect(row).toHaveAttribute('href', path)
		// Both copies are current: a browser renders only one of them per width.
		const current = [...nav.querySelectorAll('a[aria-current="page"]')].map((a) =>
			a.getAttribute('href')
		)
		expect(current).toEqual([path, path])
		const sheetCopy = nav.querySelector(`details li[data-nav-path="${path}"] > a`)
		expect(sheetCopy, `the ${label} sheet copy is not current`).toHaveAttribute(
			'aria-current',
			'page'
		)
	})
})
