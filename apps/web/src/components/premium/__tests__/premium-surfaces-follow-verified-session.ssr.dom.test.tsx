import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router'
import { act } from '@testing-library/react'
import type { ComponentType } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionSeed } from '../../../context/session-seed'
import { SessionSeedProvider } from '../../../context/session-seed-provider'
import { usePremiumAccess } from '../../../hooks/usePremiumAccess'
import {
	getVerifiedSession,
	resetVerifiedSessionForTests,
	setVerifiedSession,
} from '../../../lib/session/verifiedSession'
import { HomePage } from '../../HomePage'
import { SettingsPage } from '../../settings/settings-page'
import { PremiumFeatureGate } from '../PremiumFeatureGate'

// The store is pre-set to disagree with the seed: readers must render the seed while hydrating
// and correct afterwards. `router.load()` first, or the HTML is an unresolved Suspense boundary.

vi.mock('../../settings/account-section', () => ({
	AccountSection: () => <div data-testid="account-section" />,
}))

const SIGNED_OUT = {
	isAuthenticated: false,
	userId: null,
	email: null,
	subscriptionStatus: null,
} satisfies SessionSeed
const ENTITLED = {
	isAuthenticated: true,
	userId: 'u1',
	email: 'u1@example.test',
	subscriptionStatus: 'active',
} satisfies SessionSeed

function GatesPage() {
	return (
		<div>
			<HookProbe />
			<PremiumFeatureGate featureName="Feature" locked={<span>locked</span>}>
				<span data-testid="gate-unlocked">unlocked</span>
			</PremiumFeatureGate>
		</div>
	)
}

function HookProbe() {
	const { status } = usePremiumAccess()
	return <output data-testid="hook-status">{String(status.hasAccess)}</output>
}

/** Renders differently on the server and the client: the designed-RED control. */
let renderingOnClient = false
function Mismatch() {
	return renderingOnClient ? <i>client</i> : <b>server</b>
}

async function makeRouter(seed: SessionSeed, Reader: ComponentType, withMismatch = false) {
	const rootRoute = createRootRoute({
		component: () => (
			<SessionSeedProvider seed={seed}>
				<div>
					<Reader />
					{withMismatch && <Mismatch />}
				</div>
				<p>after</p>
			</SessionSeedProvider>
		),
	})
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ['/'] }),
	})
	await router.load()
	return router
}

async function serverHtml(seed: SessionSeed, Reader: ComponentType) {
	return renderToString(<RouterProvider router={await makeRouter(seed, Reader)} />)
}

const READERS = [
	{
		name: 'a page with a PremiumFeatureGate',
		Reader: GatesPage,
		seed: SIGNED_OUT,
		answer: ENTITLED,
		seedMarker: 'data-testid="premium-gate-locked"',
		answerApplied: (c: HTMLElement) => c.querySelector('[data-testid="gate-unlocked"]') !== null,
	},
	{
		name: 'HomePage',
		Reader: HomePage,
		seed: SIGNED_OUT,
		answer: ENTITLED,
		seedMarker: '>Premium Features</h2>',
		answerApplied: (c: HTMLElement) =>
			![...c.querySelectorAll('h2')].some((h) => h.textContent === 'Premium Features'),
	},
	{
		name: 'SettingsPage',
		Reader: SettingsPage,
		seed: ENTITLED,
		answer: SIGNED_OUT,
		seedMarker: 'id="settings-display-heading"',
		answerApplied: (c: HTMLElement) => c.querySelector('#settings-report-heading') !== null,
	},
] as const

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(() => new Promise<Response>(() => {}))
	)
})
afterEach(() => {
	resetVerifiedSessionForTests()
	vi.unstubAllGlobals()
})

describe('AC 6: the server HTML ignores the module store', () => {
	it.each(READERS)(
		'$name: the HTML with a disagreeing store answer equals the HTML with none',
		async ({ Reader, seed, answer, seedMarker }) => {
			const clean = await serverHtml(seed, Reader)
			expect(clean, 'the server HTML did not render the reader').toContain(seedMarker)
			setVerifiedSession(answer)
			const polluted = await serverHtml(seed, Reader)
			expect(polluted).toBe(clean)
		}
	)
})

async function hydrate(
	seed: SessionSeed,
	answer: SessionSeed,
	Reader: ComponentType,
	withMismatch: boolean
) {
	renderingOnClient = false
	const container = document.createElement('div')
	container.innerHTML = renderToString(
		<RouterProvider router={await makeRouter(seed, Reader, withMismatch)} />
	)
	const serverMarkup = container.innerHTML
	document.body.appendChild(container)
	setVerifiedSession(answer)
	renderingOnClient = true
	const clientRouter = await makeRouter(seed, Reader, withMismatch)

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
	await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
	spy.mockRestore()
	renderingOnClient = false
	return {
		container,
		serverMarkup,
		recoverable,
		consoleErrors,
		cleanup: () => {
			act(() => root?.unmount())
			container.remove()
		},
	}
}

describe('AC 6: hydrating with a disagreeing store answer', () => {
	/** Designed RED: without it, no recoverable error could mean the harness sees nothing. */
	it('reports a mismatch when the server and client trees differ (control)', async () => {
		const { recoverable, cleanup } = await hydrate(SIGNED_OUT, ENTITLED, GatesPage, true)
		try {
			expect(recoverable.length, 'the harness cannot see a hydration mismatch').toBeGreaterThan(0)
		} finally {
			cleanup()
		}
	})

	it.each(READERS)(
		'$name: hydrates with no mismatch, then follows the answer',
		async ({ Reader, seed, answer, seedMarker, answerApplied }) => {
			const { container, serverMarkup, recoverable, consoleErrors, cleanup } = await hydrate(
				seed,
				answer,
				Reader,
				false
			)
			try {
				expect(serverMarkup).toContain(seedMarker)
				expect(recoverable, `recoverable errors: ${recoverable.join(' | ')}`).toEqual([])
				expect(
					consoleErrors.filter((e) => /hydrat|did not match|mismatch/i.test(e)),
					'React reported a hydration mismatch'
				).toEqual([])
				expect(answerApplied(container), 'the reader did not follow the answer').toBe(true)
				expect(getVerifiedSession()).toEqual(answer)
			} finally {
				cleanup()
			}
		}
	)
})
