import { signOut } from '@/lib/account/sign-out'
import { Link, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { type SessionSeed, useSessionSeed } from '../../context/session-seed'
import { ChevronDownIcon, DISCLOSURE_CHEVRON_CLASS } from '../ui/ChevronDownIcon'
import { SettingsIcon } from '../ui/SettingsIcon'

/**
 * Persistent signed-in / Premium indicator (Story 13-2), and since story 59.3
 * the account menu a signed-in user signs out from.
 *
 * Mounted once in `routes/__root.tsx`, so every route carries an always-visible
 * signal of session state: a signed-in user sees an avatar initial (their email
 * is announced, and shown on `/settings`, since story 69.2) and — only when
 * their subscription is active or lifetime — a "Premium" marker; a signed-out visitor sees
 * "Upgrade" (→ `/pricing`, for a first-time customer — account creation
 * happens only via completed checkout there) and "Sign in" (→ `/login`, for a
 * returning one) and nothing account-specific. Deliberately NOT labelled "Get
 * Premium": that string would match the `/premium/i` substring every test in
 * this file already uses to assert the Premium MARKER is absent, turning a nav
 * link into a false positive for an unrelated assertion. Each link hides both
 * on the page it points to AND on `/login` (story 41.3, UX-DR51 — the sign-in
 * page's strip stays deliberately empty for a signed-out visitor; `/login`
 * gets its own dedicated "New here?" link in the page body instead, not a
 * second copy of this one) — see the note on the unauthenticated branch. On
 * desktop (≥640px) it sits
 * on the SAME row as the primary nav, trailing/right-aligned (story 19-3); below
 * `sm:` it is a full-width top strip above the content (GlobalNav's bottom tab
 * bar carries the nav on mobile). It is kept out of `GlobalNav` so the 320px
 * mobile tab bar is not crowded (story 13-2).
 *
 * Session resolution mirrors `settings/account-section.tsx`: a plain
 * `fetch('/api/auth/me')` in a mount effect, NOT `@tanstack/react-query` (the
 * app mounts no `QueryClientProvider`) and NOT the `usePremiumAccess` hook /
 * `checkPremiumAccessServer` server import (which throws "Buffer is not defined"
 * in the browser bundle — see the premium-check e2e Buffer gap). The fetch fails
 * closed: any error resolves to the signed-out state.
 *
 * Because this strip is mounted once at the root and never remounts on client
 * navigation, it re-resolves the session whenever the route changes (the effect
 * depends on the pathname). Without the refetch the strip would keep showing an
 * email + Premium marker for a session that ended ELSEWHERE, until a hard
 * reload: signed out in another tab, expired, or revoked server-side.
 *
 * ⚠️ Corrected by story 59.3. This paragraph used to say this app's own
 * sign-out was a client-side `router.navigate` that does not remount the root.
 * That has been false since story 58.1: sign-out is a FULL DOCUMENT LOAD
 * (`lib/account/sign-out.ts` records why), which remounts everything, so it
 * never needed the refetch. The refetch keeps `/api/auth/me` calls to one per
 * navigation and does not reset to the loading state, so a signed-in user sees
 * no flicker while browsing.
 *
 * The account menu (story 59.3, FR99; reshaped by story 69.2, FR109). A
 * signed-in user's cluster is a disclosure: the trigger shows `[avatar]
 * [chevron]`, and its panel holds a Settings link, a separator and Sign out, and
 * NOTHING else. Profiles, Report and Categories stay in the nav (FR90);
 * Settings moved OUT of the nav into this cluster by decision (Lucas,
 * 2026-09-25), which amends both FR90 and FR99. A signed-OUT visitor has no
 * menu, so they get Settings as an icon-only gear link beside "Sign in"
 * instead: no session is left without a route to `/settings`, which holds the
 * currency, theme and retirement toggles and Clear local data, all free-tier.
 * The structure, and why the trigger and the gear sit OUTSIDE the live region,
 * is recorded at the return statement below.
 *
 * First-paint resolution (story UX-1): the strip's initial state is seeded from
 * the session the root loader resolves server-side (see context/session-seed), so
 * the server HTML and the first client render already show the correct state — no
 * neutral-placeholder→content flip. Hydration stays stable because the seed is
 * identical on the server and at the client's first render (it is the loader data
 * serialized into the SSR payload). When no seed is available (rendered outside
 * the provider, e.g. unit tests), it falls back to the pre-UX-1 loading state that
 * resolves via the post-mount fetch. The outer strip always renders with a
 * reserved min-height, so any state change swaps inner content without shifting
 * layout, and the strip never pushes the document past a 320px viewport.
 */

/**
 * The one route on which the strip must not offer its "Sign in" link (story
 * 41.3, UX-DR51). Shared by the route check and the `<Link>` itself so the two
 * cannot drift apart.
 */
const LOGIN_PATH = '/login' as const

/**
 * Mirrors `LOGIN_PATH` for the "Upgrade" affordance added alongside "Sign in"
 * (UX review, 2026-09-14): a first-time visitor had no obvious path to become
 * a customer without already knowing `/pricing` is where checkout lives
 * (account creation happens ONLY via a completed Paddle checkout — `/login`
 * never creates one). Same self-link principle as UX-DR51 applies — don't
 * invite someone to the page already on screen — so this hides on `/pricing`
 * itself the same way "Sign in" hides on `/login`.
 */
const PRICING_PATH = '/pricing' as const

/**
 * Where Settings lives since story 69.2 moved it out of the nav: the account
 * menu's link (signed in) and the gear link (signed out) both point here.
 */
const SETTINGS_PATH = '/settings' as const

interface CurrentUser {
  userId: string
  email: string
  subscriptionStatus: string
}

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: CurrentUser }

/**
 * Map the SSR-resolved session seed to the initial auth state so the first frame
 * is already correct (story UX-1). No seed → the neutral loading state (resolved
 * after mount by the fetch). An authenticated seed must carry a usable email for
 * the same reason `fetchCurrentUser` guards it: the authenticated render derefs
 * `user.email`, so a seed missing it is treated as signed-out.
 */
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

/**
 * Whether the Premium pill shows. Both an active subscription and a lifetime
 * purchase (25-2) are Premium. (Until story 69.2 the account menu's narrow-width
 * email rule read it too; that rule went with the email.)
 */
function isPremium(subscriptionStatus: string): boolean {
  return subscriptionStatus === 'active' || subscriptionStatus === 'lifetime'
}

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch('/api/auth/me')
  if (!response.ok) {
    return null
  }
  const data = (await response.json()) as { user?: CurrentUser | null }
  const user = data.user
  // Defensive: a user object without a usable email is treated as signed-out.
  // The render path derefs `user.email` (avatar initial + the status region's
  // announced copy), so an endpoint contract drift that dropped `email` would
  // otherwise throw during render at the app root — above any error boundary —
  // and white-screen every route.
  if (!user || typeof user.email !== 'string' || user.email.length === 0) {
    return null
  }
  return user
}

export function AuthIndicator() {
  // Seed the initial state from the SSR-resolved session so the first paint is
  // already correct (story UX-1). Read once as an initializer — the per-navigation
  // fetch below owns freshness thereafter.
  const seed = useSessionSeed()
  const [authState, setAuthState] = useState<AuthState>(() => seedToAuthState(seed))
  // Re-resolve on every navigation so the strip never shows a stale identity
  // after a client-side sign-out (which navigates without remounting the root).
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  // Story 41.3 (UX-DR51). Which URLs count as "the sign-in page", all three
  // MEASURED against the running app rather than assumed:
  //
  //  - `/login?error=invalid_or_expired` — the target `api/auth/login/verify`
  //    redirects an expired magic link to. `location.pathname` excludes the
  //    search string, so this matches. The user who just failed to sign in is
  //    the last one who should be offered a link back here.
  //  - `/login/` — the router CANONICALISES this (307 → `/login`) before the
  //    strip ever renders, so `pathname` is never the trailing-slash form.
  //    Measured, not inferred: probed at runtime, `page.url()` reads `/login`.
  //  - `/Login`, `/LOGIN` — ⚠️ THE CASE THAT BIT. Route matching is
  //    case-INSENSITIVE by default, but `location.pathname` preserves whatever
  //    the user typed, and the router does NOT canonicalise case the way it
  //    canonicalises the trailing slash. So `/Login` really does serve the
  //    login page, and a bare `===` renders the self-link on it — the exact
  //    defect this story removes. Hence `toLowerCase()`.
  //
  // ⚠️ `GlobalNav.tsx`'s `item.to === pathname` is the in-repo precedent for
  // reading the route, and it has this same case hole — but there the failure
  // mode is benign (a nav link simply is not marked active). Here it is the
  // regression itself, so the precedent is followed for the READ and
  // deliberately not for the COMPARISON. `toLowerCase()` (not
  // `toLocaleLowerCase()`) is locale-independent, so a Turkish-locale client
  // cannot map `I` to a dotless `ı` and reopen the hole.
  const isOnLoginPage = pathname.toLowerCase() === LOGIN_PATH
  const isOnPricingPage = pathname.toLowerCase() === PRICING_PATH
  // Story 69.2 (code review, MEASURED): TanStack's active match is
  // case-SENSITIVE, but `/Settings` serves the settings page (the same hole the
  // note above describes for `/Login`). Settings left the nav, so the gear and
  // the account menu's link are the ONLY "you are here" cue that page has. They
  // therefore mark themselves from this lowercased read, not from `activeProps`.
  const isOnSettingsPage = pathname.toLowerCase() === SETTINGS_PATH

  // `pathname` now does two jobs. It is read in the render body (the route check
  // above), and it is ALSO an intentional re-run trigger for this effect: the
  // session is refetched on every navigation, so the strip never shows a stale
  // identity after a client-side sign-out. The suppression below covers the
  // SECOND job only — the value is deliberately absent from the effect's own
  // body, and removing it from the dependency array would defeat that fix.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional re-run-on-navigation dependency
  useEffect(() => {
    let active = true
    fetchCurrentUser()
      .then((user) => {
        if (!active) {
          return
        }
        setAuthState(user ? { status: 'authenticated', user } : { status: 'unauthenticated' })
      })
      .catch(() => {
        // Fail closed: any failure resolving the session shows the signed-out state.
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
      // THE ROW (story 59.3). Until 59.3 the `role="status"` region below WAS
      // the row. It could not stay the row once the cluster gained a menu: a
      // polite live region announces CHANGES TO ITS CONTENT, and this region
      // re-resolves on every navigation, so mounting the panel's "Signed in
      // as …/Sign out" markup inside it would read the menu out as a status
      // message every time it opened. The row is now this outer element, the
      // region is its child, and the account menu is a SIBLING of the region,
      // outside it.
      //
      // ⚠️ Corrected in review: the rule is NOT "no interactive content in the
      // region". The signed-out branch keeps its "Sign in" and "Upgrade" links
      // inside it — `nav-account-row.test.tsx` REQUIRES that — and toggling
      // `aria-expanded` on a descendant is an attribute change, which is not
      // announced. What must stay out is content that MOUNTS, and the panel is
      // exactly that. The decision itself is the UX record's
      // (`planning-artifacts/ux-evaluation-global-nav-2026-09-21.md`, §4).
      //
      // ⚠️ This must stay ONE root element. `__root.tsx`'s desktop row is
      // `justify-between` over exactly two children (the nav and this), and
      // `e2e/helpers/nav-width.ts` asserts that count before measuring.
      //
      // Everything that described the strip moved here with the chrome:
      //
      // Reserve height on every render (incl. SSR + the loading state) so
      // resolving the session never shifts layout. `justify-end` keeps the
      // indicator right-aligned.
      // The bar chrome (border + background) is `max-sm:`-scoped: below 640px
      // this is a standalone top strip and needs its own border/bg, but on the
      // desktop row it inherits the shared chrome from the `__root.tsx` wrapper
      // so the nav and this indicator read as one bar (story 19-3).
      //
      // NO `sm:min-w-0` since story 69.3 (decision D4). Story 59.2's review
      // added it so a long email could truncate instead of wrapping the nav;
      // story 69.2 took the email out, and then it did only harm. With a
      // `min-width` of 0 the row's BOX shrank below its content when squeezed,
      // and `justify-end` pushed the overflow LEFTWARD over the nav: at an
      // enlarged root font a press on the More chevron hit this cluster
      // (measured in 69.3's RED run: 640-675px at an 18px root, 640-750px at
      // 20px, signed out). Without it the row keeps its content width, and
      // the header row (`__root.tsx`, `sm:flex-wrap`) drops it to a line of
      // its own instead. `sm:ml-auto` keeps it right-aligned there, where
      // `justify-between` alone would push a lone item left.
      // `e2e/nav-enlarged-font{,.paid}.spec.ts` guard it.
      //
      // `sm:pr-1 lg:pr-2` (story 69.3 code review; decision, Lucas 2026-09-25):
      // the right padding is 4px below `lg`, 8px from `lg`. With JavaScript OFF
      // a signed-in Premium cluster carries the `<noscript>` gear below, and at
      // 8px it was a few px too wide for the five-item row at 640px: the header
      // wrapped it to its own line at the DEFAULT font (640-642px). This is
      // step 5 of story 69.2's width ladder, the one it did not need. From
      // `lg` the row has hundreds of px to spare, so the old 8px stays there.
      // Measured in `e2e/nav-intrinsic-width.measure.clusters.paid.spec.ts`.
      //
      // `relative`: below 640px the account panel hangs from THIS box, full
      // width, like the nav sheet hangs from the bottom bar. At 640px and up
      // the menu wrapper is `sm:relative`, so the panel hangs from the trigger.
      //
      // `data-auth-indicator` marks the whole cluster. `sweepHeaderRow`
      // (`e2e/helpers/nav-more.ts`) reads it to check the cluster stays on
      // screen.
      data-auth-indicator
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
        // The labelled live region (story 13-2). Its role, its name and its
        // height reserve survive story 59.3, and it is the SAME element across
        // loading -> resolved. What DID change, so this is not mistaken for an
        // untouched element: it is no longer the row (the chrome, `px-4`,
        // `sm:min-w-0` and `data-auth-indicator` moved to the row above), the
        // authenticated branch's email is now `sr-only`, and the reserve gains
        // the `max-sm:` calc below.
        // `shrink-0`: the "Sign in" / "Upgrade" links and the Premium pill never
        // give way.
        role="status"
        aria-label="Account status"
        //
        // `max-sm:min-h-[calc(2rem-1px)]` (story 59.3, MEASURED). Until 59.3
        // this region WAS the strip, and its `min-h-[2rem]` was the strip's
        // whole 32px, bottom border included. Nested inside the new row,
        // which carries that border, a 32px region made the 320px strip 33px
        // in every state. 31px of region plus the row's 1px border restores
        // exactly 32. At 640px and up there is no border and it stays 32px.
        className="flex min-h-[2rem] shrink-0 items-center justify-end gap-2 sm:gap-1 max-sm:min-h-[calc(2rem-1px)]"
      >
        {authState.status === 'loading' && (
          // Neutral placeholder: identical on server + first client render, holds
          // the strip's height until the session resolves. Hidden from AT.
          <span aria-hidden="true" className="h-4 w-24" />
        )}

        {/*
        Story 41.3 (UX-DR51): no "Sign in" offer on the sign-in page. Until this
        story `/login` rendered a link to `/login`, and because it is a TanStack
        `<Link>` it rendered with `aria-current="page"` and an `active` class — so
        the chrome did not merely point at the page already on screen, it
        announced that it did.

        ⚠️ This DIVERGES from UX-DR28 / story 21.1, which is the app's rule for a
        link to the current page everywhere else: `GlobalNav` and `Footer` keep
        the link and MARK it with `activeProps` + `aria-current="page"`. That rule
        is for wayfinding, where "you are here" is a useful answer. "Sign in" and
        "Upgrade" are account affordances, not navigation — an invitation to
        sign in, on the sign-in page, has no destination worth marking. Recorded
        here so a later story does not "restore consistency" by putting the link
        back.

        ⚠️ Since story 69.2 this strip ALSO carries navigation: the Settings gear
        (signed out) and the account menu's Settings link (signed in). Those two
        follow UX-DR28, not this rule — they are marked with `aria-current` on
        `/settings` rather than dropped, because Settings left the nav and they
        are the only "you are here" cue that page has. One strip, two rules, on
        purpose: the split is by what the link IS, not where it sits.

        ⚠️ `activeProps` cannot express this. It can restyle an active link but
        not decline to render one, and story 31.5 measured that misapplying it
        fails SILENTLY — it just marks nothing. The route read is `useRouterState`,
        which this component already subscribes to for the refetch effect.

        ⚠️ Only the CHILDREN are route-dependent; the wrapper above is not. Its
        `min-h-[2rem]` is the sole height reserve, so returning `null` here — or
        dropping the labelled `role="status"` region on this one route — would
        trade a dead link for a collapsed strip and a layout shift, which is the
        exact thing story 13.2 reserved the height to prevent.

        ⚠️ The `loading` and `authenticated` branches are deliberately NOT
        route-aware. An authenticated user genuinely reaches `/login` — this app
        carries no route guards anywhere, a stance recorded at
        `routes/retirement.tsx` — and the strip reporting who they are is the one
        signal that explains why the page looks wrong to them.
      */}
        {authState.status === 'unauthenticated' && (
          <>
            {/*
            "Upgrade" (UX review, 2026-09-14): a signed-out visitor had no path
            to becoming a customer from anywhere but the footer's Pricing link
            or a feature paywall. Account creation happens ONLY via a
            completed Paddle checkout on `/pricing` — this is the same
            account-status strip that already offers "Sign in" for a RETURNING
            customer, so it is also where a FIRST-TIME one should be pointed.
            Hidden on `/pricing` itself (self-link, `isOnPricingPage`) AND on
            `/login` (`isOnLoginPage`) — the sign-in page keeps its
            deliberately-empty strip (story 41.3) and gets its own "New here?"
            link in the page body instead, so this is not a second, redundant
            copy of that link sitting right next to the one thing (`/login`
            itself) it would need to avoid re-pointing at.
          */}
            {!isOnPricingPage && !isOnLoginPage && (
              <Link
                to={PRICING_PATH}
                className="rounded-md px-3 py-1 font-medium sm:px-1.5 text-green-700 transition-colors hover:bg-green-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-green-400 dark:hover:bg-gray-700"
              >
                Upgrade
              </Link>
            )}
            {!isOnLoginPage && (
              <Link
                to={LOGIN_PATH}
                className="rounded-md px-3 py-1 font-medium sm:px-1.5 text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
              >
                Sign in
              </Link>
            )}
          </>
        )}

        {authState.status === 'authenticated' && (
          <>
            {/* What a screen reader hears, unchanged by stories 59.3 and 69.2:
              "Account status, {email}, Premium". Story 59.3 moved the VISIBLE
              email into the account-menu trigger; story 69.2 (decision D2,
              Lucas 2026-09-25) removed it from the chrome altogether, so the
              only VISIBLE copy is on `/settings` (`account-section.tsx`). This
              `sr-only` copy stays: it is the announcement, and the e2e helper
              `expectSignedInAs` reads it to tell a mocked identity from a
              seeded one. The email ONLY, not "Signed in as …". */}
            <span className="sr-only">{authState.user.email}</span>
            {isPremium(authState.user.subscriptionStatus) && (
              // Text label, not color/icon alone (Story 11-3 / WCAG 1.4.1).
              // Both an active subscription and a lifetime purchase (25-2) are Premium.
              // It stays OUTSIDE the account-menu trigger and always visible
              // (story 59.3): a paying user's standing confirmation is not
              // something to put behind a click.
              <span className="shrink-0 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white dark:bg-green-500">
                Premium
              </span>
            )}
          </>
        )}
      </div>
      {authState.status === 'unauthenticated' && !isOnLoginPage && (
        // The signed-out route to Settings (story 69.2, decision D1, Lucas
        // 2026-09-25). Settings left the nav, and a signed-out visitor has no
        // account menu, so without this they could not reach the currency,
        // theme and retirement toggles or Clear local data at all.
        //
        // - OUTSIDE the `role="status"` region, like the account menu: it is
        //   navigation, and navigation has no business in a polite live region.
        //   (Only "Sign in" is REQUIRED inside it — `nav-account-row.test.tsx`.)
        // - Hidden on `/login` only (decision D3), with "Upgrade", so the
        //   sign-in page keeps the deliberately empty strip story 41.3 gave it.
        // - NOT hidden on `/settings`: marked current there instead (UX-DR28).
        //   See the 41.3 note above for why one strip follows two rules. The
        //   mark comes from `isOnSettingsPage`, not `activeProps`, so `/Settings`
        //   is marked too; `activeProps={{}}` stops TanStack adding its default
        //   `active` class (it still adds `aria-current` on an exact-case match,
        //   which agrees with ours).
        // - Icon-only, so the name is `aria-label`. The box is 28x28px, the
        //   project's target floor; its width cost at 640px is what the `sm:`
        //   padding cuts on this row and the links above pay for (measured in
        //   `e2e/nav-responsive-css.spec.ts`, the one width record).
        <Link
          to={SETTINGS_PATH}
          aria-label="Settings"
          aria-current={isOnSettingsPage ? 'page' : undefined}
          className={isOnSettingsPage ? `${GEAR_LINK_CLASS} ${GEAR_ACTIVE_CLASS}` : GEAR_LINK_CLASS}
          activeProps={{}}
        >
          <SettingsIcon className="h-4 w-4" />
        </Link>
      )}
      {authState.status === 'authenticated' && (
        // The signed-in route to Settings for a visitor with JavaScript OFF
        // (story 69.3, decision D3, Lucas 2026-09-25). Since story 69.2 a
        // signed-in user reaches Settings through the account menu, which is a
        // React `<button>` (59.3 D1), so with JavaScript off they had no route
        // at all (FR90, then marked OPEN).
        //
        // `<noscript>` costs nothing with JavaScript ON: the browser's parser
        // treats its content as inert text and the UA stylesheet hides the
        // element, so there is no second gear and no width. With JavaScript
        // OFF it is the same 28px gear as the signed-out one.
        //
        // ⚠️ HONEST SCOPE: this covers JavaScript DISABLED. It does NOT cover
        // JavaScript that fails to load, or the window before hydration; there
        // the account-menu trigger renders and does nothing until React runs.
        //
        // - A plain `<a>`, not a router `<Link>`: with scripting off no router
        //   runs, and with it on this content is never parsed into elements.
        // - Not route-aware, like the rest of this branch (see the 41.3 note).
        // - Marked current on `/settings`, like the signed-out gear.
        <noscript>
          <a
            href={SETTINGS_PATH}
            aria-label="Settings"
            aria-current={isOnSettingsPage ? 'page' : undefined}
            className={
              isOnSettingsPage ? `${GEAR_LINK_CLASS} ${GEAR_ACTIVE_CLASS}` : GEAR_LINK_CLASS
            }
          >
            <SettingsIcon className="h-4 w-4" />
          </a>
        </noscript>
      )}
    </div>
  )
}

/**
 * The signed-out Settings gear (story 69.2). `h-7 w-7` is a 28x28px box, the
 * project's target floor, with the 16px glyph centred. `shrink-0` because, like
 * "Sign in", it must never give way. Raw `gray-*` with `dark:` variants and an
 * INSET ring, matching the account panel's rows: the gear is a tight 28px box
 * beside other controls at `sm:gap-1`, and an outset ring would paint over its
 * neighbour. (Not because of the viewport edge: `sm:pr-2` leaves room there.)
 */
const GEAR_LINK_CLASS =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100'

/** The gear's `aria-current` treatment on `/settings`: `GlobalNav.tsx`'s `ACTIVE_CLASS` tone. */
const GEAR_ACTIVE_CLASS = 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'

/**
 * The trigger: `[avatar] [chevron]`.
 *
 * `min-h-[1.75rem]` + `px-2` give the BUTTON a box of at least 28px tall: the
 * project's 28px target floor. Its width is its content, 8 + 24 (avatar) + 8
 * (gap) + 16 (chevron) + 8 = 64px; the avatar is not enlarged.
 *
 * ⚠️ 28px, not the 32px (`min-h-[2rem]`) the story first specified. Below
 * 640px the strip is 32px INCLUDING its 1px bottom border, so it has 31px of
 * content height. A 32px trigger cannot fit and grows the strip. See the status
 * region's `max-sm:min-h-[calc(2rem-1px)]` for the measurement. Raw
 * `gray-*`/`green-*` with `dark:` variants, not semantic tokens: this chrome
 * follows `GlobalNav.tsx`'s convention (UX record 2026-09-21, §6).
 *
 * ⚠️ NO EMAIL, by decision (story 69.2, D2, Lucas 2026-09-25). Until 69.2 the
 * trigger was `[avatar] [email] [chevron]`, with the email truncating on a
 * narrow row and hidden outright for a Premium user between 640 and 660px. The
 * top-right stopped spending width restating who the user is. The address is
 * still announced by the status region and shown on `/settings`. ACCEPTED COST:
 * a user with two accounts sees only an initial in the chrome and must open
 * `/settings` to confirm which account they are in.
 *
 * ⚠️ NO `min-w-0` since story 69.2's code review. It existed so the email could
 * truncate; with nothing left to truncate it only let the button shrink BELOW
 * its avatar + chevron under a squeeze, overflowing its own box. Without it the
 * button holds its 64px and the squeeze goes where the row decides.
 */
const ACCOUNT_TRIGGER_CLASS =
  'flex min-h-[1.75rem] items-center gap-2 rounded-md px-2 font-medium text-gray-900 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-gray-100 dark:hover:bg-gray-700'

/**
 * The panel. Below 640px it hangs DOWN from the top strip, full width (the
 * mirror of the nav sheet's `max-sm:bottom-full`). At 640px and up it hangs
 * below the trigger, right-aligned. Opaque in both themes, and scrollable if
 * the viewport is ever shorter than it is.
 *
 * `z-40` matches the nav's desktop panel (`GlobalNav.tsx`, `SHEET_PANEL_CLASS`),
 * where it WAS measured to be load-bearing (without it, positioned content on
 * `/pricing` and `/forecasting` painted over that panel). ⚠️ For THIS panel it
 * is a precaution, not a proven need: removing it leaves the occlusion sweep in
 * `e2e/account-menu.spec.ts` green on all six routes at 320px and 1280px
 * (mutation-measured, story 59.3). No mechanism is offered for why the two
 * panels differ — an earlier version of this note guessed at one, which was an
 * inference, not a measurement. Keep the token: it costs nothing, and the nav's
 * panel shows what this page can do to an overlay. `Modal` (z-50) stays above it.
 */
const ACCOUNT_PANEL_CLASS =
  'absolute z-40 max-h-[calc(100svh-6rem)] overflow-y-auto border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800 max-sm:inset-x-0 max-sm:top-full max-sm:border-b sm:right-0 sm:top-full sm:mt-1 sm:w-max sm:min-w-[14rem] sm:max-w-[min(24rem,calc(100vw-2rem))] sm:rounded-md sm:border'

/**
 * A panel row: the Settings link and the Sign out button look the same (story
 * 69.2). `py-2 text-sm` makes each about 36px tall, like `NAV_LINK_BASE`, over
 * the 28px floor. The ring is inset so the panel's edge cannot clip it.
 * The Settings page's own Sign out is a standalone button in page content and
 * is outlined like one (story 70.2). It does not use this row style on purpose.
 */
const PANEL_ROW_CLASS =
  'block w-full px-4 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'

/** The Sign out row: the shared row, plus its in-flight (`disabled`) state. */
const SIGN_OUT_CLASS = `${PANEL_ROW_CLASS} disabled:cursor-wait disabled:opacity-60`

/**
 * The Settings row's `aria-current` treatment, the same tone as `GlobalNav.tsx`'s
 * `ACTIVE_CLASS`. It shows only while the panel is open on `/settings`; the
 * panel closes on any navigation, so that is the one case it can be seen.
 */
const PANEL_ROW_ACTIVE_CLASS = 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'

/**
 * The account menu (story 59.3, FR99): a signed-in user signs out here, and
 * since story 69.2 (FR109) reaches Settings here.
 *
 * Mounted ONLY in the authenticated branch. So the open state cannot survive
 * a sign-out and come back open at the next sign-in: leaving the branch
 * unmounts this component and its state with it.
 *
 * ⚠️ A DISCLOSURE, not a menu (UX record 2026-09-21, §4). No `role="menu"`
 * and no `aria-haspopup`: two plain controls (a link and a button, story 69.2)
 * do not clear the bar for the menu pattern, which would also demand arrow-key
 * roving focus. Tab reaches them in DOM order, as it does in the nav's More.
 * The precedent NOT to copy was the profiles switcher's `aria-haspopup` without a menu panel — that component
 * (`profiles/switch-profile.tsx`) was deleted by story 63.1, so the anti-pattern
 * is named here rather than pointed at.
 *
 * ⚠️ A `<button aria-expanded>`, NOT the `<details>`/`<summary>` the nav's More
 * uses (decision D1, Lucas 2026-09-22). The nav chose `<details>` so its ROUTES
 * stay reachable with JavaScript off. That cannot apply here: signing out is a
 * `fetch` POST plus a document load, so it needs JavaScript however the panel
 * opens. `<details>` would have cost what 59.2 measured: `<summary>` has no role
 * in Playwright or testing-library, a closed `<details>` keeps its content in
 * the DOM for every CSS and jsdom query, and a click before hydration desyncs
 * `open` from React state. The panel is rendered only while open instead.
 *
 * ⚠️ `aria-label="Account menu"`, EXACTLY. Every probe in the suite names it
 * that way.
 *
 * ✅ The WCAG 2.5.3 (Label in Name, Level A) failure that story 59.3 raised and
 * Lucas ACCEPTED on 2026-09-22 is RESOLVED FOR THE EMAIL by story 69.2. It
 * existed because the button's visible text was the user's email while its
 * name was the fixed "Account menu", so a voice-control user saying the email
 * could not activate it. Since 69.2 the email is gone from the button.
 *
 * ⚠️ Not "no visible text at all" (corrected in 69.2's code review): the avatar
 * INITIAL is still visible to a sighted user, `aria-hidden` notwithstanding,
 * and "Account menu" does not contain "U". Whether a one-letter avatar is a
 * text LABEL under 2.5.3 is arguable (it reads as an image of identity, not a
 * caption), so this is recorded as resolved for the email and ARGUABLE for the
 * initial, not settled. `deferred-work.md` and FR99 say the same.
 *
 * The dismissal machinery mirrors `GlobalNav.tsx`'s More disclosure: Escape and
 * an outside press close it, focus returns to the trigger only when nothing else
 * has claimed it, the document listeners exist only while open, and any pathname
 * change closes it. (It was deliberately NOT modelled on the profiles switcher,
 * whose listeners were always-on and unscoped; story 63.1 deleted that component,
 * so only the good precedent remains.) Copied rather than shared, because extracting a hook would
 * reopen `GlobalNav.tsx`, which this story has no other reason to touch. A
 * shared hook is logged in `deferred-work.md`.
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
  /** Whether the in-flight pointer gesture STARTED outside the menu. */
  const outsidePressRef = useRef(false)
  // SSR-stable, so the server and client agree on `aria-controls`.
  const panelId = useId()

  const closeMenu = useCallback((restoreFocus = true) => {
    setIsOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  // Close on ANY navigation, before paint: React's "adjusting state when a
  // prop changes" pattern, as `GlobalNav.tsx` does for More. Focus is not
  // restored; the user has gone somewhere else.
  const [lastPathname, setLastPathname] = useState(pathname)
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setIsOpen(false)
  }

  useEffect(() => {
    if (!isOpen) return

    const isOutside = (target: EventTarget | null): boolean =>
      !(target instanceof Node) || !menuRef.current?.contains(target)

    // Whether a real focusable OUTSIDE the menu holds focus. `<body>`, `<html>`
    // and null do not count: that is orphaned focus, which the trigger should
    // reclaim. See `GlobalNav.tsx` for why "is focus inside?" is the wrong
    // question.
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
    // Both halves are load-bearing (story 31.3's lesson): press-origin alone
    // lets an outside-press -> inside-release gesture close the panel, and
    // release-origin alone lets a press that began inside close it.
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
      // Reset, so a sign-out that timed out instead of navigating leaves the
      // control usable. Review MEASURED the alternative: a hung POST left this
      // button disabled for the rest of the session, across close, reopen and
      // navigation.
      setIsSigningOut(false)
    }
  }

  // ⚠️ There is deliberately NO `if (isSigningOut) return` here. Two mechanisms
  // already cover a double activation, and a third that cannot be reached is
  // worse than none: the button is `disabled` from the first click (so no
  // second click is dispatched at all), and `signOut()` dedupes at module
  // level, which is what covers a same-tick double dispatch AND the other
  // control on `/settings`. Both are tested — `sign-out.test.ts` "joins an
  // in-flight sign-out".

  return (
    // `sm:relative` makes this the box the desktop panel hangs from; below
    // 640px it is not positioned, so the panel resolves against the full-width
    // strip instead. (No `min-w-0`: see `ACCOUNT_TRIGGER_CLASS`.)
    <div ref={menuRef} className="flex sm:relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Account menu"
        aria-expanded={isOpen}
        // Only while open: the panel is rendered only then, and an
        // `aria-controls` pointing at an id that is not in the document is a
        // dangling IDREF (axe exempts it while collapsed, so no gate catches
        // it, but a screen reader's "go to controlled element" lands nowhere).
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
        <ChevronDownIcon className={`${DISCLOSURE_CHEVRON_CLASS}${isOpen ? ' rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div id={panelId} className={ACCOUNT_PANEL_CLASS}>
          {/* Settings (story 69.2, FR109). A real router `<Link>`, so the
              panel's existing dismissal covers it: a pathname change closes the
              panel before paint. ⚠️ The explicit `onClick` is for the ONE case
              that does not change the pathname, a click on Settings while
              already on `/settings`. The press starts and ends inside the menu,
              so the outside-press guard correctly declines, and without this
              the panel stayed open. `GlobalNav.tsx`'s sheet rows solved the
              same thing the same way. Wrapped, not passed by reference:
              `closeMenu` takes an optional `restoreFocus`, and React would pass
              its MouseEvent into it. Focus returns to the trigger, as it does
              from a sheet row; a real navigation then closes nothing more. */}
          <Link
            to={SETTINGS_PATH}
            onClick={() => closeMenu()}
            // Marked from the lowercased read, like the gear (`/Settings`).
            aria-current={isOnSettingsPage ? 'page' : undefined}
            className={
              isOnSettingsPage ? `${PANEL_ROW_CLASS} ${PANEL_ROW_ACTIVE_CLASS}` : PANEL_ROW_CLASS
            }
            activeProps={{}}
          >
            Settings
          </Link>
          <hr className="border-gray-200 dark:border-gray-700" />
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
