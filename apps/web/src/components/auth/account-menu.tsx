import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { signOut } from '@/lib/account/sign-out'
import { cn } from '@/lib/cn'
import { ChevronDownIcon, DISCLOSURE_CHEVRON_CLASS } from '../ui/ChevronDownIcon'

const SETTINGS_PATH = '/settings' as const

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
export function AccountMenu({
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
