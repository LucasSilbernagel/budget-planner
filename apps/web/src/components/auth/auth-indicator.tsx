import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { setVerifiedSession } from '@/lib/session/verifiedSession'
import { useSessionSeed } from '../../hooks/useSessionSeed'
import { SettingsIcon } from '../ui/SettingsIcon'
import { AccountMenu } from './account-menu'
import {
	type AuthState,
	answerToSeed,
	fetchCurrentUser,
	isPremium,
	seedToAuthState,
} from './auth-session'

// Mounted once at the root and never remounted on client navigation, so it refetches
// the session on each route change. The fetch fails closed to signed-out.

const LOGIN_PATH = '/login' as const

const PRICING_PATH = '/pricing' as const

const SETTINGS_PATH = '/settings' as const

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
