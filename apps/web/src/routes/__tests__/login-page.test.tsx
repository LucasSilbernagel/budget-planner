// `Route.useSearch()` needs the file route's match, which a throwaway router cannot give,
// so that one hook is stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionSeedProvider } from '@/context/session-seed-provider'
import { renderWithRouter, screen, waitFor, within } from '@/test/utils'
import { AuthIndicator } from '../../components/auth/auth-indicator'
import { Route } from '../login'

const LoginPage = Route.options.component as () => React.ReactElement
const SIGNED_OUT = { isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }

function renderChrome(path: string, withPage: boolean) {
	return renderWithRouter(
		<SessionSeedProvider seed={SIGNED_OUT}>
			<AuthIndicator />
			{withPage && <LoginPage />}
		</SessionSeedProvider>,
		{ path }
	)
}

const strip = () => screen.findByRole('status', { name: /account status/i })

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: null }), { status: 200 })))
	)
	vi.spyOn(Route, 'useSearch').mockReturnValue({ error: undefined } as never)
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('/login — the sign-in card beside the strip', () => {
	it('keeps its heading, consent links and "Continue without account", and no "All rights reserved"', async () => {
		renderChrome('/login', true)

		// Scoped by role: the strip has no Sign in link here, so an unscoped text match would hit
		// the heading alone and stop distinguishing the card from the strip.
		expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument()

		const consent = screen.getByText(/by signing in, you agree to our/i)
		expect(within(consent).getByRole('link', { name: /terms of service/i })).toHaveAttribute(
			'href',
			'/terms'
		)
		expect(within(consent).getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
			'href',
			'/privacy'
		)
		// Link colour alone is below 3:1 against the text; WCAG 1.4.1 needs a non-colour cue.
		for (const link of within(consent).getAllByRole('link')) {
			expect([...link.classList]).toContain('underline')
			expect([...link.classList]).not.toContain('hover:underline')
		}

		expect(screen.getByRole('link', { name: /continue without account/i })).toHaveAttribute(
			'href',
			'/'
		)
		expect(screen.queryByText(/all rights reserved/i)).toBeNull()
	})

	// A bare absence on /login could not tell a dropped link from a strip that never rendered.
	it('drops the strip’s "Sign in" on /login while the Overview keeps it, and the card stays', async () => {
		const home = renderChrome('/', false)
		expect(await within(await strip()).findByRole('link', { name: /sign in/i })).toHaveAttribute(
			'href',
			'/login'
		)
		home.unmount()

		renderChrome('/login', true)
		expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument()
		const region = await strip()
		await waitFor(() => expect(region.children).toHaveLength(0))
		expect(within(region).queryByRole('link', { name: /sign in/i })).toBeNull()
	})

	it('is exactly one <main> landmark', async () => {
		renderChrome('/login', true)
		expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument()
		expect(screen.getAllByRole('main')).toHaveLength(1)
	})
})
