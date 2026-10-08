import { Link, useRouterState } from '@tanstack/react-router'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSessionSeed } from '../../context/session-seed'
import { isEntitledSeed } from '../../lib/premium/entitlement'
import { useVerifiedSession } from '../../lib/session/verifiedSession'
import { useShowRetirementPlanner } from '../../stores/plannerVisibilityStore'
import { ChevronDownIcon, DISCLOSURE_CHEVRON_CLASS } from '../ui/ChevronDownIcon'
import { SettingsIcon } from '../ui/SettingsIcon'

// One DOM subtree switched by CSS alone (`max-sm:` bottom bar), never a viewport hook: the
// first painted frame must be final. More is a native <details> so it works without JS.

type NavPath =
  | '/'
  | '/income'
  | '/expenses'
  | '/savings'
  | '/balance'
  | '/retirement'
  | '/forecasting'
  | '/profiles'
  | '/financial-summary'
  | '/categories'

interface NavItem {
  label: string
  to: NavPath
  exact?: boolean
  Icon: (props: { className: string }) => React.ReactElement
}

const PRIMARY_TABS: readonly NavItem[] = [
  { label: 'Overview', to: '/', exact: true, Icon: HomeIcon },
  { label: 'Income', to: '/income', Icon: IncomeIcon },
  { label: 'Expenses', to: '/expenses', Icon: ExpensesIcon },
  { label: 'Savings', to: '/savings', Icon: SavingsIcon },
]

const MORE_DESTINATIONS: readonly NavItem[] = [
  // Deliberately shorter than the page's H1: the desktop row is width-critical.
  { label: 'Balances', to: '/balance', Icon: BalanceIcon },
  { label: 'Retirement', to: '/retirement', Icon: RetirementIcon },
  // Settings is not here: this list is also PROMOTED_PATHS. Its phone-only row is rendered separately.
]

// Labels are deliberately shorter than the benefit names elsewhere; don't align them.
const PREMIUM_DESTINATIONS: readonly NavItem[] = [
  { label: 'Forecasting', to: '/forecasting', Icon: ForecastingIcon },
  { label: 'Profiles', to: '/profiles', Icon: ProfilesIcon },
  { label: 'Financial Summary', to: '/financial-summary', Icon: ReportIcon },
  { label: 'Categories', to: '/categories', Icon: CategoriesIcon },
]

// Exported for the route parity test: this nav is a paid user's only route to these pages.
export const PREMIUM_NAV_ROUTES: readonly string[] = PREMIUM_DESTINATIONS.map((item) => item.to)

const MORE_DESTINATIONS_ENTITLED: readonly NavItem[] = [
  ...MORE_DESTINATIONS,
  ...PREMIUM_DESTINATIONS,
]

// The mobile variants are separate strings, not appended overrides: Tailwind source order
// decides conflicts, not className order.
const NAV_LINK_BASE =
  'inline-block rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'

// `max-sm:focus-visible:ring-inset`: an outset ring is clipped off-screen on the edge cells.
// `max-sm:text-[11px]` sets the bar height and keeps the widest label fitting.
const TAB_LINK_CLASS = `${NAV_LINK_BASE} max-sm:flex max-sm:h-full max-sm:min-h-[44px] max-sm:flex-col max-sm:items-center max-sm:justify-center max-sm:gap-0.5 max-sm:break-words max-sm:rounded-none max-sm:px-1 max-sm:text-center max-sm:text-[11px] max-sm:leading-tight max-sm:focus-visible:ring-inset`

const SHEET_ROW_CLASS = `${NAV_LINK_BASE} sm:block sm:whitespace-nowrap max-sm:flex max-sm:min-h-[44px] max-sm:items-center max-sm:gap-3 max-sm:rounded-none max-sm:px-4 max-sm:py-3 max-sm:text-sm max-sm:leading-tight max-sm:focus-visible:ring-inset`

const ACTIVE_CLASS = 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'

const PROMOTED_PATHS: ReadonlySet<string> = new Set(MORE_DESTINATIONS.map((item) => item.to))

const PROMOTED_ROW_CELL_CLASS = 'hidden lg:block'

const PROMOTED_SHEET_CELL_CLASS = 'max-sm:min-w-0 lg:hidden'

// Scoped `max-lg:`: at `lg` the row anchor is the cue, so More must not light too.
const MORE_CELL_CLASS = 'max-sm:min-w-0 sm:relative'

const LG_MEDIA_QUERY = '(min-width: 1024px)'

const PROMOTED_ACTIVE_BELOW_LG_CLASS =
  'max-lg:bg-green-50 max-lg:text-green-700 dark:max-lg:bg-green-900/30 dark:max-lg:text-green-300'

const SETTINGS_PATH = '/settings'

// Not in any destination list: that would make it a promoted path (a desktop row copy)
// and light More at every width.
const SETTINGS_SHEET_CELL_CLASS = 'max-sm:min-w-0 sm:hidden'

// Scoped `max-sm:`: Settings is behind More only below 640px.
const SETTINGS_ACTIVE_BELOW_SM_CLASS =
  'max-sm:bg-green-50 max-sm:text-green-700 dark:max-sm:bg-green-900/30 dark:max-sm:text-green-300'

// The webkit-details-marker token hides WebKit's triangle. No hand-rolled ARIA: browsers
// already expose <summary> as an expandable disclosure.
const MORE_TRIGGER_CLASS = `${NAV_LINK_BASE} cursor-pointer list-none sm:pr-2 [&::-webkit-details-marker]:hidden max-sm:flex max-sm:h-full max-sm:min-h-[44px] max-sm:w-full max-sm:flex-col max-sm:items-center max-sm:justify-center max-sm:gap-0.5 max-sm:rounded-none max-sm:px-1 max-sm:text-center max-sm:text-[11px] max-sm:leading-tight max-sm:focus-visible:ring-inset`

// Rotates on the native `open` attribute, never `isMoreOpen`: they disagree before hydration
// and with JS off. Desktop-only: `max-sm:hidden`, never `sm:hidden`.
const MORE_CHEVRON_CLASS = `${DISCLOSURE_CHEVRON_CLASS} ml-1 inline-block align-middle max-sm:hidden group-open:rotate-180`

// `sm:z-40` stops positioned page content painting over the dropdown. The max-height cap and
// scroll stop the out-of-flow sheet growing off the top of the screen.
const SHEET_PANEL_CLASS =
  'sm:absolute sm:left-0 sm:top-full sm:z-40 sm:mt-1 sm:min-w-[10rem] sm:max-h-[calc(100svh-6rem)] sm:overflow-y-auto sm:rounded-md sm:border sm:border-gray-200 sm:bg-white sm:py-1 sm:shadow-lg dark:sm:border-gray-700 dark:sm:bg-gray-800 max-sm:absolute max-sm:inset-x-0 max-sm:bottom-full max-sm:max-h-[calc(100svh-5rem)] max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:border-t max-sm:border-gray-200 max-sm:bg-white max-sm:py-1 dark:max-sm:border-gray-700 dark:max-sm:bg-gray-800'

export function GlobalNav() {
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLElement>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  /** Reset on every terminal path, including `pointercancel` (a touch that becomes a scroll). */
  const outsidePressRef = useRef(false)

  // More is not a route, so `activeProps` can't mark it. Router state is hydration-safe here.
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  // One list read twice (rows and `moreActiveClass`), so More can't claim a destination the sheet lacks.
  const showRetirementPlanner = useShowRetirementPlanner()

  // Seeded once as an initializer, not `usePremiumAccess()` (it would flip after first paint).
  // Fails closed; then follows the indicator's last definitive answer.
  const seed = useSessionSeed()
  const [seedEntitled] = useState(() => isEntitledSeed(seed))
  const verifiedSession = useVerifiedSession()
  const isEntitled = verifiedSession === undefined ? seedEntitled : isEntitledSeed(verifiedSession)

  const visibleMoreDestinations = useMemo(() => {
    const destinations = isEntitled ? MORE_DESTINATIONS_ENTITLED : MORE_DESTINATIONS
    return showRetirementPlanner
      ? destinations
      : destinations.filter((item) => item.to !== '/retirement')
  }, [isEntitled, showRetirementPlanner])

  const promotedRowDestinations = useMemo(
    () => visibleMoreDestinations.filter((item) => PROMOTED_PATHS.has(item.to)),
    [visibleMoreDestinations]
  )

  const activeMoreItem = visibleMoreDestinations.find((item) => item.to === pathname)
  const moreActiveClass =
    activeMoreItem === undefined
      ? ''
      : PROMOTED_PATHS.has(activeMoreItem.to)
        ? PROMOTED_ACTIVE_BELOW_LG_CLASS
        : ACTIVE_CLASS

  // Derived from the list, not the tier, so a future free destination stays reachable at `lg`.
  const moreNeededAtLg = visibleMoreDestinations.some((item) => !PROMOTED_PATHS.has(item.to))

  // Lowercased: `/Settings` serves the page, but TanStack's active match is case-sensitive.
  const isOnSettingsPage = pathname.toLowerCase() === SETTINGS_PATH
  const triggerActiveClass = [
    moreActiveClass,
    isOnSettingsPage ? SETTINGS_ACTIVE_BELOW_SM_CLASS : '',
  ]
    .filter(Boolean)
    .join(' ')

  // Light-dismiss passes `false`: restoring from `pointerup` would steal focus from what was clicked.
  const closeMore = useCallback((restoreFocus = true) => {
    setIsMoreOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  // Close on any navigation, in render so it happens before paint: bar tabs have no onClick
  // and the press never leaves the nav.
  const [lastPathname, setLastPathname] = useState(pathname)
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setIsMoreOpen(false)
  }

  // Adopt a <details> opened before hydration, or the dismissal listeners are never armed.
  useEffect(() => {
    if (detailsRef.current?.open) setIsMoreOpen(true)
  }, [])

  // Close a More with nothing to disclose when resized into `lg`: it goes display:none still open.
  useEffect(() => {
    if (moreNeededAtLg || typeof globalThis.matchMedia !== 'function') return
    const atLg = globalThis.matchMedia(LG_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) setIsMoreOpen(false)
    }
    atLg.addEventListener('change', handleChange)
    return () => atLg.removeEventListener('change', handleChange)
  }, [moreNeededAtLg])

  useEffect(() => {
    if (!isMoreOpen) return

    const isOutside = (target: EventTarget | null): boolean =>
      !(target instanceof Node) || !navRef.current?.contains(target)

    // `<body>`, `<html>` and null are orphaned focus, which the trigger should reclaim.
    const focusClaimedOutside = (): boolean => {
      const active = document.activeElement
      return (
        active instanceof Node &&
        active !== document.body &&
        active !== document.documentElement &&
        !navRef.current?.contains(active)
      )
    }

    // Only if focus is in the nav or orphaned: a keyboard user may have tabbed past the open dropdown.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMore(!focusClaimedOutside())
    }
    // Both halves are needed: press-origin alone closes on outside-press/inside-release, and
    // release-origin alone closes on a press that began on a sheet row.
    const handlePointerDown = (event: PointerEvent) => {
      outsidePressRef.current = isOutside(event.target)
    }
    const handlePointerUp = (event: PointerEvent) => {
      const closedByGesture = outsidePressRef.current && isOutside(event.target)
      outsidePressRef.current = false
      if (closedByGesture) {
        closeMore(!focusClaimedOutside())
      }
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
  }, [isMoreOpen, closeMore])

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      // Below `sm` the bar is fixed (out of flow), so it owns its border and background.
      // `sm:shrink-0` stops the nav wrapping when the account cluster is wide.
      className="sm:shrink-0 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:border-t max-sm:border-gray-200 max-sm:bg-white max-sm:pb-[env(safe-area-inset-bottom)] dark:max-sm:border-gray-700 dark:max-sm:bg-gray-800"
    >
      {/* `pl-4`, not `px-4`: the missing right padding pays for the More chevron at 640px. The bar's
          height is coupled to the root layout's bottom reserve and InstallPrompt's offset. */}
      <ul className="flex flex-wrap gap-1 py-2 pl-4 max-sm:grid max-sm:grid-cols-5 max-sm:gap-0 max-sm:px-0 max-sm:py-0">
        {PRIMARY_TABS.map((item) => (
          <li key={item.to} className="max-sm:min-w-0" data-nav-path={item.to}>
            <Link
              to={item.to}
              activeOptions={item.exact ? { exact: true } : undefined}
              className={TAB_LINK_CLASS}
              activeProps={{ 'aria-current': 'page', className: ACTIVE_CLASS }}
              // Same-route clicks never change the pathname, so close here. `false`: the link keeps focus.
              onClick={() => closeMore(false)}
            >
              <item.Icon className="h-6 w-6 sm:hidden" />
              {/* Wrapped so a line-count probe can range over the label text alone. */}
              <span data-nav-label>{item.label}</span>
            </Link>
          </li>
        ))}
        {/* `data-nav-path` is matched by the pre-paint `[data-hide-retirement]` CSS rule. */}
        {promotedRowDestinations.map((item) => (
          <li
            key={`row-${item.to}`}
            className={PROMOTED_ROW_CELL_CLASS}
            data-nav-path={item.to}
            data-nav-promoted
          >
            <Link
              to={item.to}
              className={NAV_LINK_BASE}
              activeProps={{ 'aria-current': 'page', className: ACTIVE_CLASS }}
              onClick={() => closeMore(false)}
            >
              <span data-nav-label>{item.label}</span>
            </Link>
          </li>
        ))}
        {/* Not positioned below `sm`: the sheet must resolve `absolute` against the fixed <nav>. */}
        <li className={moreNeededAtLg ? MORE_CELL_CLASS : `${MORE_CELL_CLASS} lg:hidden`}>
          <details
            ref={detailsRef}
            open={isMoreOpen}
            onToggle={(event) => setIsMoreOpen(event.currentTarget.open)}
            // `onToggle` adopts `open` changes React didn't cause (find-in-page, script). The
            // suppression covers only the pre-hydration click adopted on mount.
            suppressHydrationWarning
            // `group-open:` matches any open `.group` ancestor; none exists above the nav.
            className="group max-sm:h-full"
          >
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: a <summary> is natively keyboard-operable; a keydown handler would double-toggle */}
            <summary
              ref={triggerRef}
              // Once hydrated, React owns the toggle: natively, the listeners arm only after the async
              // `toggle` event, so an early outside press was ignored. Without JS the native toggle works.
              onClick={(event) => {
                event.preventDefault()
                setIsMoreOpen((open) => !open)
              }}
              className={
                triggerActiveClass
                  ? `${MORE_TRIGGER_CLASS} ${triggerActiveClass}`
                  : MORE_TRIGGER_CLASS
              }
            >
              <MoreIcon className="h-6 w-6 sm:hidden" />
              <span data-nav-label>More</span>
              <ChevronDownIcon data-disclosure-chevron className={MORE_CHEVRON_CLASS} />
            </summary>
            <ul className={SHEET_PANEL_CLASS}>
              {visibleMoreDestinations.map((item) => (
                <li
                  key={item.to}
                  className={
                    PROMOTED_PATHS.has(item.to) ? PROMOTED_SHEET_CELL_CLASS : 'max-sm:min-w-0'
                  }
                  data-nav-path={item.to}
                >
                  <Link
                    to={item.to}
                    className={SHEET_ROW_CLASS}
                    activeProps={{ 'aria-current': 'page', className: ACTIVE_CLASS }}
                    // Wrapped: passing `closeMore` directly would hand it the MouseEvent as `restoreFocus`.
                    onClick={() => closeMore()}
                  >
                    <item.Icon className="h-6 w-6 sm:hidden" />
                    <span data-nav-label>{item.label}</span>
                  </Link>
                </li>
              ))}
              {/* `activeProps={{}}`: the active class comes from the lowercased read instead. */}
              <li
                className={SETTINGS_SHEET_CELL_CLASS}
                data-nav-path={SETTINGS_PATH}
                data-nav-settings
              >
                <Link
                  to={SETTINGS_PATH}
                  aria-current={isOnSettingsPage ? 'page' : undefined}
                  className={
                    isOnSettingsPage ? `${SHEET_ROW_CLASS} ${ACTIVE_CLASS}` : SHEET_ROW_CLASS
                  }
                  activeProps={{}}
                  onClick={() => closeMore()}
                >
                  <SettingsIcon className="h-6 w-6 sm:hidden" />
                  <span data-nav-label>Settings</span>
                </Link>
              </li>
            </ul>
          </details>
        </li>
      </ul>
    </nav>
  )
}

// Every icon is rendered with `sm:hidden` by its caller; without it the desktop nav grows.

function HomeIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  )
}

function IncomeIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  )
}

function ExpensesIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
      />
    </svg>
  )
}

function SavingsIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 9v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function MoreIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
      />
    </svg>
  )
}

function BalanceIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
      />
    </svg>
  )
}

function RetirementIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function ForecastingIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
      />
    </svg>
  )
}

function ProfilesIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  )
}

function ReportIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  )
}

function CategoriesIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
      />
    </svg>
  )
}
