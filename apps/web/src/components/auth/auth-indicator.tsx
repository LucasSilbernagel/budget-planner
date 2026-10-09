import { Link, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { signOut } from '@/lib/account/sign-out'
import { cn } from '@/lib/cn'
import { hasPremiumFeatures } from '@/lib/premium/access-statuses'
import { setVerifiedSession } from '@/lib/session/verifiedSession'
import {
	type SeedSubscriptionStatus,
	type SessionSeed,
	SIGNED_OUT_SEED,
	useSessionSeed,
} from '../../context/session-seed'
import { ChevronDownIcon, DISCLOSURE_CHEVRON_CLASS } from '../ui/ChevronDownIcon'
import { SettingsIcon } from '../ui/SettingsIcon'

// Mounted once at the root and never remounted on client navigation, so it refetches
// the session on each route change. The fetch fails closed to signed-out.

const LOGIN_PATH = '/login' as const

const PRICING_PATH = '/pricing' as const

const SETTINGS_PATH = '/settings' as const

type CurrentUser = {
	userId: string
	email: string
	subscriptionStatus: string
}

type AuthState =
	| { status: 'loading' }
	| { status: 'unauthenticated' }
	| { status: 'authenticated'; user: CurrentUser }

/** An authenticated seed without a usable email is treated as signed-out: the render derefs it. */
function seedToAuthState(seed: SessionSeed | null): AuthState {
	if (!seed) {
		return { status: 'loading' }
	}
	if (seed.isAuthenticated && seed.email) {
		return {
			status: 'authenticated',
			user: {
				userId: seed.userId ?? '',
				email: seed.email,
				subscriptionStatus: seed.subscriptionStatus ?? 'free',
			},
		}
	}
	return { status: 'unauthenticated' }
}

function isPremium(subscriptionStatus: string): boolean {
	return hasPremiumFeatures(subscriptionStatus)
}

/**
 * `definitive` only for a 200 whose body parses as `{ user: null }` or a user with an
 * email. Every other answer displays as signed-out but isn't shared with the nav.
 */
type MeAnswer = { definitive: true; user: CurrentUser | null } | { definitive: false }

async function fetchCurrentUser(): Promise<MeAnswer> {
	const response = await fetch('/api/auth/me')
	if (!response.ok) {
		return { definitive: false }
	}
	const data = (await response.json()) as { user?: CurrentUser | null } | null
	const user = data?.user
	if (user === null) {
		return { definitive: true, user: null }
	}
	// The render derefs `user.email` at the app root, above any error boundary, so a
	// contract drift that dropped it would white-screen every route.
	if (!user || typeof user.email !== 'string' || user.email.length === 0) {
		return { definitive: false }
	}
	return { definitive: true, user }
}

function answerToSeed(user: CurrentUser | null): SessionSeed {
	if (!user) {
		return SIGNED_OUT_SEED
	}
	return {
		isAuthenticated: true,
		userId: user.userId,
		email: user.email,
		subscriptionStatus: user.subscriptionStatus as SeedSubscriptionStatus,
	}
}

export function AuthIndicator() {
	// Read once as an initializer; the per-navigation fetch owns freshness after that.
	const seed = useSessionSeed()
	const [authState, setAuthState] = useState<AuthState>(() => seedToAuthState(seed))
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	// Lowercased: routes match case-insensitively but pathname keeps the typed case. Only
	// the unauthenticated branch reads this; the other branches are deliberately NOT route-aware.
	const isOnLoginPage = pathname.toLowerCase() === LOGIN_PATH
	const isOnPricingPage = pathname.toLowerCase() === PRICING_PATH
	// TanStack's active match is case-sensitive but /Settings serves the page, so the
	// Settings links are marked from this lowercased read, not activeProps.
	const isOnSettingsPage = pathname.toLowerCase() === SETTINGS_PATH

	// `pathname` is also a re-run trigger: the session refetches on every navigation so the
	// strip never shows a stale identity. Dropping it from the deps would break that.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional re-run-on-navigation dependency
	useEffect(() => {
		let active = true
		fetchCurrentUser()
			.then((answer) => {
				if (!active) {
					return
				}
				const user = answer.definitive ? answer.user : null
				setAuthState(user ? { status: 'authenticated', user } : { status: 'unauthenticated' })
				// Only a definitive answer is shared with the nav; an unknown one keeps what it had.
				// Written only here, in an effect, so never during a server render.
				if (answer.definitive) {
					setVerifiedSession(answerToSeed(answer.user))
				}
			})
			.catch(() => {
				if (active) {
					setAuthState({ status: 'unauthenticated' })
				}
			})
		return () => {
			active = false
		}
	}, [pathname])

	return (
		<div
			// One root element (the desktop row is justify-between over two children). The account
			// menu sits outside the live region, so opening it isn't announced as a status.
			data-auth-indicator
			// No `sm:min-w-0`: a squeezed row would push its overflow left over the nav.
			className="relative flex min-h-[2rem] items-center justify-end gap-2 px-4 text-sm sm:ml-auto sm:gap-1 sm:pr-1 lg:pr-2 max-sm:border-b max-sm:border-gray-200 max-sm:bg-white dark:max-sm:border-gray-700 dark:max-sm:bg-gray-800"
		>
			{authState.status === 'authenticated' && (
				<AccountMenu
					email={authState.user.email}
					pathname={pathname}
					isOnSettingsPage={isOnSettingsPage}
				/>
			)}
			<div
				role="status"
				aria-label="Account status"
				// 44px plus the row's 1px border holds 45px in every state, so no state is shorter
				// than another.
				className="flex min-h-[2rem] shrink-0 items-center justify-end gap-2 sm:gap-1 max-sm:min-h-[44px]"
			>
				{authState.status === 'loading' && (
					// Identical on server and first client render; holds the height until resolved.
					<span aria-hidden="true" className="h-4 w-24" />
				)}

				{/* No "Sign in" on /login: "Sign in" and "Upgrade" are account affordances, not navigation. */}
				{authState.status === 'unauthenticated' && (
					<>
						{/* Hidden on /pricing (a self-link) and on /login, whose strip stays deliberately empty. */}
						{!isOnPricingPage && !isOnLoginPage && (
							<Link
								to={PRICING_PATH}
								className={cn(
									'rounded-md px-3 py-1 font-medium sm:px-1.5',
									PHONE_TARGET_CLASS,
									'text-green-700 transition-colors hover:bg-green-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-green-400 dark:hover:bg-gray-700'
								)}
							>
								Upgrade
							</Link>
						)}
						{!isOnLoginPage && (
							<Link
								to={LOGIN_PATH}
								className={cn(
									'rounded-md px-3 py-1 font-medium sm:px-1.5',
									PHONE_TARGET_CLASS,
									'text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'
								)}
							>
								Sign in
							</Link>
						)}
					</>
				)}

				{authState.status === 'authenticated' && (
					<>
						{/* The email's only copy in the chrome: what a screen reader announces. */}
						<span className="sr-only">{authState.user.email}</span>
						{isPremium(authState.user.subscriptionStatus) && (
							// Text label, not colour alone (WCAG 1.4.1), and outside the menu trigger so it's
							// always visible.
							<span className="fill-green shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">
								Premium
							</span>
						)}
					</>
				)}
			</div>
			{authState.status === 'unauthenticated' && !isOnLoginPage && (
				// Outside the live region because it's navigation, so it's marked current on /settings, not hidden.
				<Link
					to={SETTINGS_PATH}
					aria-label="Settings"
					aria-current={isOnSettingsPage ? 'page' : undefined}
					className={isOnSettingsPage ? cn(GEAR_LINK_CLASS, GEAR_ACTIVE_CLASS) : GEAR_LINK_CLASS}
					activeProps={{}}
				>
					<SettingsIcon className="h-4 w-4" />
				</Link>
			)}
			{authState.status === 'authenticated' && (
				// The signed-in Settings route with JavaScript disabled (the menu is a React button).
				// Inert with JS on; it doesn't cover JS that fails to load.
				<noscript>
					<a
						href={SETTINGS_PATH}
						aria-label="Settings"
						aria-current={isOnSettingsPage ? 'page' : undefined}
						className={isOnSettingsPage ? cn(GEAR_LINK_CLASS, GEAR_ACTIVE_CLASS) : GEAR_LINK_CLASS}
					>
						<SettingsIcon className="h-4 w-4" />
					</a>
				</noscript>
			)}
		</div>
	)
}

/** `min-height` alone would leave the label at the top of the 44px box, so flex centres it. */
const PHONE_TARGET_CLASS =
	'max-sm:inline-flex max-sm:min-h-[44px] max-sm:min-w-[44px] max-sm:items-center max-sm:justify-center'

/**
 * Inset ring: an outset one would paint over its neighbour at `sm:gap-1`. `max-sm:hidden`
 * wins over the unprefixed `flex` by source order, not specificity.
 */
const GEAR_LINK_CLASS =
	'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100 max-sm:hidden'

const GEAR_ACTIVE_CLASS = 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'

/**
 * No email, by decision: the status region announces it. No `min-w-0`: it let the button
 * shrink below its avatar and chevron.
 */
const ACCOUNT_TRIGGER_CLASS =
	'flex min-h-[1.75rem] max-sm:min-h-[44px] max-sm:min-w-[44px] items-center gap-2 rounded-md px-2 font-medium text-gray-900 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-gray-100 dark:hover:bg-gray-700'

/** `z-40` matches the nav's panel, where it was needed; here it's a cheap precaution. */
const ACCOUNT_PANEL_CLASS =
	'absolute z-40 max-h-[calc(100svh-6rem)] overflow-y-auto border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800 max-sm:inset-x-0 max-sm:top-full max-sm:border-b sm:right-0 sm:top-full sm:mt-1 sm:w-max sm:min-w-[14rem] sm:max-w-[min(24rem,calc(100vw-2rem))] sm:rounded-md sm:border'

/** Ring inset so the panel's edge can't clip it; `py-3` centres the label in the 44px phone row. */
const PANEL_ROW_CLASS =
	'block w-full px-4 py-2 max-sm:min-h-[44px] max-sm:py-3 text-left max-sm:text-center text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'

const SIGN_OUT_CLASS = cn(PANEL_ROW_CLASS, 'disabled:cursor-wait disabled:opacity-60')

/** Visible only while the panel is open on /settings: any navigation closes it. */
const PANEL_ROW_ACTIVE_CLASS = 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'

/** Never on PANEL_ROW_CLASS itself: SIGN_OUT_CLASS builds on it, and Sign out must show on phones. */
const HIDDEN_BELOW_SM = 'max-sm:hidden'

/**
 * A disclosure, not a menu: no role="menu" or aria-haspopup for two plain controls. A
 * button, not <details>: sign-out needs JS anyway. Probes name it "Account menu" exactly.
 */
function AccountMenu({
	email,
	pathname,
	isOnSettingsPage,
}: {
	email: string
	pathname: string
	isOnSettingsPage: boolean
}) {
	const [isOpen, setIsOpen] = useState(false)
	const [isSigningOut, setIsSigningOut] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const outsidePressRef = useRef(false)
	// SSR-stable, so the server and client agree on `aria-controls`.
	const panelId = useId()

	const closeMenu = useCallback((restoreFocus = true) => {
		setIsOpen(false)
		if (restoreFocus) triggerRef.current?.focus()
	}, [])

	// Close on any navigation, before paint (adjusting state when a prop changes).
	const [lastPathname, setLastPathname] = useState(pathname)
	if (pathname !== lastPathname) {
		setLastPathname(pathname)
		setIsOpen(false)
	}

	useEffect(() => {
		if (!isOpen) return

		const isOutside = (target: EventTarget | null): boolean =>
			!(target instanceof Node) || !menuRef.current?.contains(target)

		// `<body>`, `<html>` and null are orphaned focus, which the trigger should reclaim.
		const focusClaimedOutside = (): boolean => {
			const active = document.activeElement
			return (
				active instanceof Node &&
				active !== document.body &&
				active !== document.documentElement &&
				!menuRef.current?.contains(active)
			)
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') closeMenu(!focusClaimedOutside())
		}
		// Both halves needed: press-origin alone lets outside-press/inside-release close it,
		// and release-origin alone lets a press that began inside close it.
		const handlePointerDown = (event: PointerEvent) => {
			outsidePressRef.current = isOutside(event.target)
		}
		const handlePointerUp = (event: PointerEvent) => {
			const closedByGesture = outsidePressRef.current && isOutside(event.target)
			outsidePressRef.current = false
			if (closedByGesture) closeMenu(!focusClaimedOutside())
		}
		const handlePointerCancel = () => {
			outsidePressRef.current = false
		}

		document.addEventListener('keydown', handleKeyDown)
		document.addEventListener('pointerdown', handlePointerDown)
		document.addEventListener('pointerup', handlePointerUp)
		document.addEventListener('pointercancel', handlePointerCancel)
		return () => {
			document.removeEventListener('keydown', handleKeyDown)
			document.removeEventListener('pointerdown', handlePointerDown)
			document.removeEventListener('pointerup', handlePointerUp)
			document.removeEventListener('pointercancel', handlePointerCancel)
			outsidePressRef.current = false
		}
	}, [isOpen, closeMenu])

	const handleSignOut = async (): Promise<void> => {
		setIsSigningOut(true)
		try {
			await signOut()
		} finally {
			// Reset, so a sign-out that timed out instead of navigating leaves the control usable.
			setIsSigningOut(false)
		}
	}

	// No isSigningOut guard: the button is disabled from the first click, and signOut()
	// dedupes in-flight calls.

	return (
		// The desktop panel hangs from this box; below 640px it resolves against the strip.
		<div ref={menuRef} className="flex sm:relative">
			<button
				ref={triggerRef}
				type="button"
				aria-label="Account menu"
				aria-expanded={isOpen}
				// Only while open: the panel exists only then, and a dangling IDREF misleads screen readers.
				aria-controls={isOpen ? panelId : undefined}
				onClick={() => setIsOpen((open) => !open)}
				className={ACCOUNT_TRIGGER_CLASS}
			>
				<span
					aria-hidden="true"
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-300"
				>
					{email.charAt(0).toUpperCase()}
				</span>
				<ChevronDownIcon className={cn(DISCLOSURE_CHEVRON_CLASS, isOpen && ' rotate-180')} />
			</button>
			{isOpen && (
				<div id={panelId} className={ACCOUNT_PANEL_CLASS}>
					{/* onClick covers clicking Settings while already on /settings, which changes no pathname.
             Wrapped so React's MouseEvent isn't passed as restoreFocus. */}
					<Link
						to={SETTINGS_PATH}
						onClick={() => closeMenu()}
						aria-current={isOnSettingsPage ? 'page' : undefined}
						className={
							isOnSettingsPage
								? cn(PANEL_ROW_CLASS, PANEL_ROW_ACTIVE_CLASS, HIDDEN_BELOW_SM)
								: cn(PANEL_ROW_CLASS, HIDDEN_BELOW_SM)
						}
						activeProps={{}}
					>
						Settings
					</Link>
					<hr className={cn('border-gray-200 dark:border-gray-700', HIDDEN_BELOW_SM)} />
					<button
						type="button"
						onClick={handleSignOut}
						disabled={isSigningOut}
						className={SIGN_OUT_CLASS}
					>
						Sign out
					</button>
				</div>
			)}
		</div>
	)
}
