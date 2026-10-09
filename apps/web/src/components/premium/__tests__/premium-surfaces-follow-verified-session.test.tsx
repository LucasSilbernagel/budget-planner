import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@/test/utils'

import {
	type SessionSeed,
	SessionSeedProvider,
	SIGNED_OUT_SEED,
} from '../../../context/session-seed'
import { usePremiumAccess } from '../../../hooks/usePremiumAccess'
import {
	getVerifiedSession,
	resetVerifiedSessionForTests,
} from '../../../lib/session/verifiedSession'
import { AuthIndicator } from '../../auth/auth-indicator'
import { HomePage } from '../../HomePage'
import { SettingsPage } from '../../settings/settings-page'
import { PremiumFeatureGate } from '../PremiumFeatureGate'

// Stubbed: it runs its own `/api/auth/me` fetch, which would muddy the request count.
vi.mock('../../settings/account-section', () => ({
	AccountSection: () => <div data-testid="account-section" />,
}))

// Answers are held until the first paint is asserted; post-answer state is asserted only after
// the answer reaches the store (`findBy*` would resolve on the pre-answer render).

const PAID = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' }
type Me = typeof PAID
const withStatus = (subscriptionStatus: string): Me => ({ ...PAID, subscriptionStatus })
const seedOf = (subscriptionStatus: SessionSeed['subscriptionStatus']): SessionSeed => ({
	isAuthenticated: true,
	userId: PAID.userId,
	email: PAID.email,
	subscriptionStatus,
})
const ENTITLED_SEED = seedOf('active')
const FREE_SEED = seedOf('free')

afterEach(() => {
	// Module state: an unreset store leaks one test's answer into the next first paint.
	resetVerifiedSessionForTests()
	vi.restoreAllMocks()
})

/** The indicator calls `fetch(url)` bare; the hook's own check passes an `Accept` header. */
type Caller = 'indicator' | 'hook'

function stubMe(answer: (caller: Caller) => Response | Promise<Response>, delayMs = 0) {
	const me = vi.fn(answer)
	global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
		if (String(input).includes('/api/auth/me')) {
			const caller: Caller = init?.headers ? 'hook' : 'indicator'
			const run = () => Promise.resolve().then(() => me(caller))
			if (delayMs === 0) return run()
			return new Promise<Response>((resolve, reject) =>
				setTimeout(() => run().then(resolve, reject), delayMs)
			)
		}
		return Promise.resolve(new Response('{}', { status: 200 }))
	}) as typeof global.fetch
	return me
}
const meIs = (user: Me | null) => () => new Response(JSON.stringify({ user }), { status: 200 })

function held(answer: () => Response | Promise<Response>) {
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

const UNKNOWN_ANSWERS = [
	{ name: 'a 503', answer: () => new Response('{}', { status: 503 }) },
	{
		name: 'a network error',
		answer: (): Response => {
			throw new TypeError('Failed to fetch')
		},
	},
	{ name: 'a 200 that is not JSON', answer: () => new Response('<html>', { status: 200 }) },
	{ name: 'a 200 with an empty body object', answer: () => new Response('{}', { status: 200 }) },
	{
		name: 'a 200 whose user has no email',
		answer: () => new Response(JSON.stringify({ user: { ...PAID, email: '' } }), { status: 200 }),
	},
] as const

const GATE_COUNT = 3

function GatesPage() {
	return (
		<div data-testid="reader">
			<h1>Gates page</h1>
			<HookProbe />
			{Array.from({ length: GATE_COUNT }, (_, i) => (
				<PremiumFeatureGate
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed list
					key={i}
					featureName={`Feature ${i}`}
					locked={<span>locked {i}</span>}
				>
					<span data-testid="gate-unlocked">unlocked {i}</span>
				</PremiumFeatureGate>
			))}
		</div>
	)
}

function HookProbe() {
	const { status } = usePremiumAccess()
	return <output data-testid="hook-status">{JSON.stringify(status)}</output>
}

function OverviewPage() {
	return (
		<div data-testid="reader">
			<HomePage />
		</div>
	)
}

function Settings() {
	return (
		<div data-testid="reader">
			<SettingsPage />
		</div>
	)
}

function renderApp(seed: SessionSeed | null, Reader: ComponentType, path = '/') {
	const rootRoute = createRootRoute({
		component: () => (
			<SessionSeedProvider seed={seed}>
				<AuthIndicator />
				<Reader />
			</SessionSeedProvider>
		),
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren(
			['/', '/income', '/expenses'].map((p) =>
				createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null })
			)
		),
		history: createMemoryHistory({ initialEntries: [path] }),
	})
	const result = render(<RouterProvider router={router} />)
	return { router, ...result }
}

const hookStatus = () => JSON.parse(screen.getByTestId('hook-status').textContent ?? 'null')
const unlockedGates = () => screen.queryAllByTestId('gate-unlocked').length
const lockedGates = () => screen.queryAllByTestId('premium-gate-locked').length
const skeletonGates = () => screen.queryAllByTestId('premium-gate-skeleton').length

function overviewSectionShown(): boolean {
	expect(screen.getByText('Track your finances with privacy and control')).toBeInTheDocument()
	return screen.queryByRole('heading', { level: 2, name: 'Premium Features' }) !== null
}

function settingsSectionsShown(): boolean {
	expect(document.getElementById('settings-display-heading')).not.toBeNull()
	const report = document.getElementById('settings-report-heading') !== null
	const categories = document.getElementById('settings-categories-heading') !== null
	expect(report, 'the two Settings sections disagree').toBe(categories)
	return report
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 30)))

async function answerApplied() {
	await waitFor(() => expect(getVerifiedSession()).toBeDefined())
	await settle()
}

describe('AC 1: a definitive premium answer unlocks every reader', () => {
	const NOT_ENTITLED_SEEDS = [
		{ name: 'signed-out seed', seed: SIGNED_OUT_SEED as SessionSeed },
		{ name: 'null seed', seed: null },
		{ name: 'free seed', seed: FREE_SEED },
		{ name: 'past_due seed', seed: seedOf('past_due') },
		{ name: 'canceled seed', seed: seedOf('canceled') },
	]

	for (const delayMs of [0, 50]) {
		describe(`answer delay ${delayMs} ms`, () => {
			it.each(NOT_ENTITLED_SEEDS)(
				'$name + an active answer: the hook resolves premium and every gate unlocks',
				async ({ seed }) => {
					const answer = held(meIs(PAID))
					stubMe(answer.respond, delayMs)
					renderApp(seed, GatesPage)
					await screen.findByText('Gates page')
					expect(unlockedGates(), 'first paint already unlocked').toBe(0)
					answer.release()
					await answerApplied()

					expect(hookStatus()).toEqual({
						hasAccess: true,
						subscriptionStatus: 'active',
						isLoading: false,
						error: null,
						isAuthenticated: true,
					})
					expect(unlockedGates()).toBe(GATE_COUNT)
					expect(lockedGates()).toBe(0)
					expect(skeletonGates()).toBe(0)
				}
			)
		})
	}

	it.each(NOT_ENTITLED_SEEDS)(
		'$name + a lifetime answer: the Overview "Premium Features" section goes',
		async ({ seed }) => {
			const answer = held(meIs(withStatus('lifetime')))
			stubMe(answer.respond)
			renderApp(seed, OverviewPage)
			await screen.findByText('Track your finances with privacy and control')
			expect(overviewSectionShown(), 'first paint is the seed: shown').toBe(true)
			answer.release()
			await answerApplied()
			expect(overviewSectionShown()).toBe(false)
		}
	)

	it.each(NOT_ENTITLED_SEEDS)(
		'$name + an active answer: the Settings Report and Categories sections go',
		async ({ seed }) => {
			const answer = held(meIs(PAID))
			stubMe(answer.respond)
			renderApp(seed, Settings)
			await screen.findByRole('heading', { level: 1, name: /^settings$/i })
			expect(settingsSectionsShown(), 'first paint is the seed: shown').toBe(true)
			answer.release()
			await answerApplied()
			expect(settingsSectionsShown()).toBe(false)
		}
	)

	it.each([
		{ name: 'gates', Reader: GatesPage, check: () => unlockedGates() === GATE_COUNT },
		{ name: 'Overview', Reader: OverviewPage, check: () => !overviewSectionShown() },
		{ name: 'Settings', Reader: Settings, check: () => !settingsSectionsShown() },
	])(
		'a tab open from before sign-in (C2): $name follow a premium answer that arrives on a client navigation',
		async ({ Reader, check }) => {
			let signedIn = false
			const me = stubMe(() => meIs(signedIn ? PAID : null)())
			const { router } = renderApp(SIGNED_OUT_SEED, Reader)
			await waitFor(() => expect(getVerifiedSession()).toEqual(SIGNED_OUT_SEED))
			await settle()
			expect(check(), 'premium before the session existed').toBe(false)

			signedIn = true
			const callsBefore = me.mock.calls.length
			await act(async () => {
				await router.navigate({ to: '/income' })
			})
			await waitFor(() => expect(getVerifiedSession()?.subscriptionStatus).toBe('active'))
			await settle()
			expect(me.mock.calls.length).toBeGreaterThan(callsBefore)
			expect(check()).toBe(true)
		}
	)

	it('no extra request: with a seed, /api/auth/me is asked once per navigation, whatever the number of gates', async () => {
		const me = stubMe(meIs(PAID))
		const { router } = renderApp(SIGNED_OUT_SEED, GatesPage)
		await answerApplied()
		expect(unlockedGates()).toBe(GATE_COUNT)
		expect(me).toHaveBeenCalledTimes(1)

		await act(async () => {
			await router.navigate({ to: '/income' })
		})
		await waitFor(() => expect(me).toHaveBeenCalledTimes(2))
		await settle()
		expect(me).toHaveBeenCalledTimes(2)
		expect(unlockedGates()).toBe(GATE_COUNT)
	})
})

describe('a definitive not-entitled answer over an entitled seed locks (symmetric)', () => {
	const NOT_ENTITLED_ANSWERS = [
		{
			name: 'signed out',
			user: null,
			hook: { isAuthenticated: false, subscriptionStatus: null },
		},
		{
			name: 'free',
			user: withStatus('free'),
			hook: { isAuthenticated: true, subscriptionStatus: 'free' },
		},
		{
			name: 'past_due',
			user: withStatus('past_due'),
			hook: { isAuthenticated: true, subscriptionStatus: 'past_due' },
		},
		{
			name: 'canceled',
			user: withStatus('canceled'),
			hook: { isAuthenticated: true, subscriptionStatus: 'canceled' },
		},
	]

	it.each(NOT_ENTITLED_ANSWERS)(
		'entitled seed + $name answer: the hook reports no access and every gate locks',
		async ({ user, hook }) => {
			const answer = held(meIs(user))
			stubMe(answer.respond)
			renderApp(ENTITLED_SEED, GatesPage)
			await screen.findByText('Gates page')
			expect(unlockedGates(), 'first paint is the seed: unlocked').toBe(GATE_COUNT)
			answer.release()
			await answerApplied()
			expect(hookStatus()).toEqual({ hasAccess: false, isLoading: false, error: null, ...hook })
			expect(unlockedGates()).toBe(0)
			expect(lockedGates()).toBe(GATE_COUNT)
		}
	)

	it.each(NOT_ENTITLED_ANSWERS)(
		'entitled seed + $name answer: the Overview section shows',
		async ({ user }) => {
			const answer = held(meIs(user))
			stubMe(answer.respond)
			renderApp(ENTITLED_SEED, OverviewPage)
			await screen.findByText('Track your finances with privacy and control')
			expect(overviewSectionShown(), 'first paint is the seed: hidden').toBe(false)
			answer.release()
			await answerApplied()
			expect(overviewSectionShown()).toBe(true)
		}
	)

	it.each(NOT_ENTITLED_ANSWERS)(
		'entitled seed + $name answer: the Settings sections show',
		async ({ user }) => {
			const answer = held(meIs(user))
			stubMe(answer.respond)
			renderApp(ENTITLED_SEED, Settings)
			await screen.findByRole('heading', { level: 1, name: /^settings$/i })
			expect(settingsSectionsShown(), 'first paint is the seed: hidden').toBe(false)
			answer.release()
			await answerApplied()
			expect(settingsSectionsShown()).toBe(true)
		}
	)

	it('an unknown status string resolves to no access, inside the declared union', async () => {
		stubMe(meIs(withStatus('trialing')))
		renderApp(ENTITLED_SEED, GatesPage)
		await answerApplied()
		expect(hookStatus()).toEqual({
			hasAccess: false,
			subscriptionStatus: 'free',
			isLoading: false,
			error: null,
			isAuthenticated: true,
		})
		expect(lockedGates()).toBe(GATE_COUNT)
	})
})

describe('AC 3: an unknown answer changes nothing', () => {
	it.each(UNKNOWN_ANSWERS)(
		'$name with no earlier answer: every reader keeps its seed',
		async ({ answer }) => {
			for (const [seed, gatesUnlocked, sectionsShown] of [
				[SIGNED_OUT_SEED, 0, true],
				[ENTITLED_SEED, GATE_COUNT, false],
			] as const) {
				for (const Reader of [GatesPage, OverviewPage, Settings]) {
					const me = stubMe(answer)
					const { unmount } = renderApp(seed, Reader)
					await waitFor(() => expect(me).toHaveBeenCalled())
					await settle()
					await screen.findByRole('link', { name: /sign in/i })
					expect(getVerifiedSession(), 'an unknown answer was recorded').toBeUndefined()
					if (Reader === GatesPage) expect(unlockedGates()).toBe(gatesUnlocked)
					if (Reader === OverviewPage) expect(overviewSectionShown()).toBe(sectionsShown)
					if (Reader === Settings) expect(settingsSectionsShown()).toBe(sectionsShown)
					unmount()
				}
			}
		}
	)

	it.each(UNKNOWN_ANSWERS)(
		'a premium answer, then $name on the next navigation: every reader keeps the premium answer',
		async ({ answer }) => {
			for (const Reader of [GatesPage, OverviewPage, Settings]) {
				let fail = false
				const me = stubMe(() => (fail ? answer() : meIs(PAID)()))
				const { router, unmount } = renderApp(SIGNED_OUT_SEED, Reader)
				await answerApplied()

				fail = true
				const callsBefore = me.mock.calls.length
				await act(async () => {
					await router.navigate({ to: '/income' })
				})
				await waitFor(() => expect(me.mock.calls.length).toBeGreaterThan(callsBefore))
				await settle()
				await screen.findByRole('link', { name: /sign in/i })
				expect(getVerifiedSession()?.subscriptionStatus).toBe('active')
				if (Reader === GatesPage) expect(unlockedGates()).toBe(GATE_COUNT)
				if (Reader === OverviewPage) expect(overviewSectionShown()).toBe(false)
				if (Reader === Settings) expect(settingsSectionsShown()).toBe(false)
				unmount()
				resetVerifiedSessionForTests()
			}
		}
	)

	/** A hook check failing after a definitive premium answer is unknown and must not lock the gates. */
	it.each([
		{ name: 'a 503', fail: () => new Response('{}', { status: 503 }) },
		{
			name: 'a network error',
			fail: (): Response => {
				throw new TypeError('Failed to fetch')
			},
		},
	])(
		'null seed: the hook’s own check failing with $name after a premium answer keeps the gates unlocked (DS1)',
		async ({ fail }) => {
			const late = held(fail)
			const me = stubMe((caller) => (caller === 'indicator' ? meIs(PAID)() : late.respond()))
			renderApp(null, GatesPage)
			await waitFor(() => expect(me.mock.calls.length).toBeGreaterThanOrEqual(1 + GATE_COUNT))
			await answerApplied()
			expect(unlockedGates(), 'the premium answer did not unlock').toBe(GATE_COUNT)

			late.release()
			await settle()
			await settle()
			expect(hookStatus()).toMatchObject({ hasAccess: true, subscriptionStatus: 'active' })
			expect(unlockedGates()).toBe(GATE_COUNT)
			expect(lockedGates()).toBe(0)
		}
	)

	it('null seed: a SUCCESSFUL own check after the verified answer is definitive too, and wins (last one wins)', async () => {
		const late = held(meIs(withStatus('free')))
		const me = stubMe((caller) => (caller === 'indicator' ? meIs(PAID)() : late.respond()))
		renderApp(null, GatesPage)
		await waitFor(() => expect(me.mock.calls.length).toBeGreaterThanOrEqual(1 + GATE_COUNT))
		await answerApplied()
		expect(unlockedGates()).toBe(GATE_COUNT)
		late.release()
		await settle()
		await settle()
		expect(lockedGates()).toBe(GATE_COUNT)
	})
})

describe('AC 4: with no definitive answer every reader keeps today’s behaviour', () => {
	const neverAnswer = () => new Promise<Response>(() => {})

	it('Overview and Settings fail OPEN on a null seed (the opposite of the nav, on purpose)', async () => {
		stubMe(neverAnswer)
		const overview = renderApp(null, OverviewPage)
		await screen.findByText('Track your finances with privacy and control')
		await settle()
		expect(getVerifiedSession()).toBeUndefined()
		expect(overviewSectionShown(), 'Overview must FAIL OPEN on a null seed').toBe(true)
		overview.unmount()

		renderApp(null, Settings)
		await screen.findByRole('heading', { level: 1, name: /^settings$/i })
		await settle()
		expect(settingsSectionsShown(), 'Settings must FAIL OPEN on a null seed').toBe(true)
	})

	it.each([
		{ name: 'signed-out', seed: SIGNED_OUT_SEED as SessionSeed, shown: true },
		{ name: 'entitled', seed: ENTITLED_SEED, shown: false },
	])('Overview and Settings follow a $name seed', async ({ seed, shown }) => {
		stubMe(neverAnswer)
		const overview = renderApp(seed, OverviewPage)
		await screen.findByText('Track your finances with privacy and control')
		expect(overviewSectionShown()).toBe(shown)
		overview.unmount()
		renderApp(seed, Settings)
		await screen.findByRole('heading', { level: 1, name: /^settings$/i })
		expect(settingsSectionsShown()).toBe(shown)
	})

	it('the hook: a seed resolves at once with no client check of its own', async () => {
		const me = stubMe(neverAnswer)
		renderApp(ENTITLED_SEED, GatesPage)
		await screen.findByText('Gates page')
		await settle()
		expect(hookStatus()).toMatchObject({ hasAccess: true, isLoading: false })
		expect(me).toHaveBeenCalledTimes(1)
	})

	it('the hook: a null seed starts loading (fail closed) and asks for itself, once per gate', async () => {
		const me = stubMe(neverAnswer)
		renderApp(null, GatesPage)
		await screen.findByText('Gates page')
		await settle()
		expect(hookStatus()).toMatchObject({ hasAccess: false, isLoading: true })
		expect(skeletonGates()).toBe(GATE_COUNT)
		// The indicator + one check per hook instance (3 gates + the probe).
		expect(me).toHaveBeenCalledTimes(1 + GATE_COUNT + 1)
	})

	it('the hook: a null seed whose own check answers premium unlocks, with no indicator answer needed', async () => {
		stubMe((caller) => (caller === 'indicator' ? neverAnswer() : meIs(PAID)()))
		renderApp(null, GatesPage)
		await waitFor(() => expect(unlockedGates()).toBe(GATE_COUNT))
		expect(getVerifiedSession()).toBeUndefined()
	})
})

describe('DS2: a gate mounting after the answer uses it and asks nothing', () => {
	it('null seed, premium answer held: gates mounted later start unlocked with no request of their own', async () => {
		const me = stubMe(meIs(PAID))
		const rootRoute = createRootRoute({
			component: () => (
				<SessionSeedProvider seed={null}>
					<AuthIndicator />
				</SessionSeedProvider>
			),
		})
		const router = createRouter({
			routeTree: rootRoute.addChildren(
				['/', '/income'].map((p) =>
					createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null })
				)
			),
			history: createMemoryHistory({ initialEntries: ['/'] }),
		})
		const app = render(<RouterProvider router={router} />)
		await answerApplied()
		expect(me).toHaveBeenCalledTimes(1)

		const gates = render(
			<SessionSeedProvider seed={null}>
				<GatesPage />
			</SessionSeedProvider>
		)
		expect(skeletonGates(), 'the late gates flashed a skeleton').toBe(0)
		expect(unlockedGates()).toBe(GATE_COUNT)
		await settle()
		expect(me, 'a late gate asked /api/auth/me itself').toHaveBeenCalledTimes(1)
		gates.unmount()
		app.unmount()
	})

	/** The hook's value is recorded on every render: RTL's `act` flushes the effect, hiding a locked first commit. */
	it('signed-out seed, premium answer held: a gate mounted later is unlocked from its very first render', async () => {
		const me = stubMe(meIs(PAID))
		const rootRoute = createRootRoute({
			component: () => (
				<SessionSeedProvider seed={SIGNED_OUT_SEED}>
					<AuthIndicator />
				</SessionSeedProvider>
			),
		})
		const router = createRouter({
			routeTree: rootRoute.addChildren([
				createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null }),
			]),
			history: createMemoryHistory({ initialEntries: ['/'] }),
		})
		const app = render(<RouterProvider router={router} />)
		await answerApplied()
		expect(getVerifiedSession()?.subscriptionStatus).toBe('active')

		const seen: boolean[] = []
		function Recorder() {
			const { status } = usePremiumAccess()
			seen.push(status.hasAccess)
			return null
		}
		const gates = render(
			<SessionSeedProvider seed={SIGNED_OUT_SEED}>
				<Recorder />
				<GatesPage />
			</SessionSeedProvider>
		)
		expect(seen[0], 'the first render used the stale seed, not the held answer').toBe(true)
		expect(seen, 'a render reported no access').not.toContain(false)
		expect(lockedGates()).toBe(0)
		expect(unlockedGates()).toBe(GATE_COUNT)
		await settle()
		expect(me, 'a late gate asked /api/auth/me itself').toHaveBeenCalledTimes(1)
		gates.unmount()
		app.unmount()
	})
})

describe('AC 5: when seed and answer agree no DOM node is added or removed in any reader', () => {
	const AGREE = [
		{ name: 'paid seed + active answer', seed: ENTITLED_SEED, user: PAID as Me | null },
		{
			name: 'signed-out seed + signed-out answer',
			seed: SIGNED_OUT_SEED as SessionSeed,
			user: null,
		},
		{ name: 'free seed + free answer', seed: FREE_SEED, user: withStatus('free') },
		{
			name: 'signed-out seed + free answer',
			seed: SIGNED_OUT_SEED as SessionSeed,
			user: withStatus('free'),
		},
	]
	const READERS = [
		{ reader: 'gates', Reader: GatesPage },
		{ reader: 'Overview', Reader: OverviewPage },
		{ reader: 'Settings', Reader: Settings },
	]

	it.each(AGREE.flatMap((a) => READERS.map((r) => ({ ...a, ...r }))))(
		'$reader, $name: no node added or removed, no transient skeleton',
		async ({ seed, user, Reader }) => {
			const answer = held(meIs(user))
			stubMe((caller) => (caller === 'indicator' ? answer.respond() : meIs(user)()))
			renderApp(seed, Reader)
			const reader = await screen.findByTestId('reader')
			await settle()

			const changes: string[] = []
			const observer = new MutationObserver((records) => {
				for (const r of records) {
					for (const n of [...r.addedNodes, ...r.removedNodes]) {
						changes.push(
							n instanceof Element ? n.outerHTML.slice(0, 100) : `#text ${n.textContent}`
						)
					}
				}
			})
			observer.observe(reader, { childList: true, subtree: true })
			answer.release()
			await answerApplied()
			expect(getVerifiedSession(), 'the answer never reached the store').toBeDefined()
			observer.disconnect()
			expect(changes, 'a reader flipped although seed and answer agree').toEqual([])
		}
	)
})
