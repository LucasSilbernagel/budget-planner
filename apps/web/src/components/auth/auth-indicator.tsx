import { signOut } from '@/lib/account/sign-out'
import { Link, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { type SessionSeed, useSessionSeed } from '../../context/session-seed'

/**
 * Persistent signed-in / Premium indicator (Story 13-2), and since story 59.3
 * the account menu a signed-in user signs out from.
 *
 * Mounted once in `routes/__root.tsx`, so every route carries an always-visible
 * signal of session state: a signed-in user sees their email and — only when
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
 * The account menu (story 59.3, FR99). A signed-in user's cluster is a
 * disclosure: the trigger shows `[avatar] [email] [chevron]`, and its panel
 * holds "Signed in as {email}", a separator and Sign out, and NOTHING else.
 * Profiles, Report, Categories and Settings stay in the nav by decision (FR90).
 * The structure, and why the trigger sits OUTSIDE the live region, is recorded
 * at the return statement below.
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
 * purchase (25-2) are Premium. One predicate, read by the pill AND by the
 * account menu's narrow-width rule, so the two cannot disagree about who has
 * the pill.
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
  // The render path derefs `user.email` (avatar initial + label), so an endpoint
  // contract drift that dropped `email` would otherwise throw during render at
  // the app root — above any error boundary — and white-screen every route.
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
      // indicator right-aligned; `min-w-0` + `truncate` on the email guard 320px.
      // The bar chrome (border + background) is `max-sm:`-scoped: below 640px
      // this is a standalone top strip and needs its own border/bg, but on the
      // desktop row it inherits the shared chrome from the `__root.tsx` wrapper
      // so the nav and this indicator read as one bar (story 19-3).
      //
      // `sm:min-w-0` (story 59.2, code review): on the desktop row this strip is
      // a flex item beside the nav, and a flex item's default `min-width: auto`
      // is its CONTENT width. A long email therefore could not shrink, the
      // `truncate` below never engaged, and the nav wrapped to 2-3 rows instead
      // (measured: 3 rows at 640px). With it, the strip yields width and the
      // email truncates. The nav is `sm:shrink-0` for the same reason. `sm:`
      // only, so the 320px top strip is untouched.
      //
      // `relative`: below 640px the account panel hangs from THIS box, full
      // width, like the nav sheet hangs from the bottom bar. At 640px and up
      // the menu wrapper is `sm:relative`, so the panel hangs from the trigger.
      //
      // `data-auth-indicator` marks the whole cluster. `sweepHeaderRow`
      // (`e2e/helpers/nav-more.ts`) reads it to check the cluster stays on
      // screen.
      data-auth-indicator
      className="relative flex min-h-[2rem] items-center justify-end gap-2 px-4 text-sm sm:min-w-0 max-sm:border-b max-sm:border-gray-200 max-sm:bg-white dark:max-sm:border-gray-700 dark:max-sm:bg-gray-800"
    >
      {authState.status === 'authenticated' && (
        <AccountMenu
          email={authState.user.email}
          isPremium={isPremium(authState.user.subscriptionStatus)}
          pathname={pathname}
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
        // `shrink-0`: on a narrow desktop row the email in the trigger is what
        // gives way, never the "Sign in" / "Upgrade" links or the Premium pill.
        role="status"
        aria-label="Account status"
        //
        // `max-sm:min-h-[calc(2rem-1px)]` (story 59.3, MEASURED). Until 59.3
        // this region WAS the strip, and its `min-h-[2rem]` was the strip's
        // whole 32px, bottom border included. Nested inside the new row,
        // which carries that border, a 32px region made the 320px strip 33px
        // in every state. 31px of region plus the row's 1px border restores
        // exactly 32. At 640px and up there is no border and it stays 32px.
        className="flex min-h-[2rem] shrink-0 items-center justify-end gap-2 max-sm:min-h-[calc(2rem-1px)]"
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
        is for wayfinding, where "you are here" is a useful answer. This strip is
        an account affordance (its status, plus the account menu's Sign out), not
        navigation — an invitation to sign in, on the sign-in page, has no
        destination worth marking. Recorded here so a
        later story does not "restore consistency" by putting the link back.

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
                className="rounded-md px-3 py-1 font-medium text-green-700 transition-colors hover:bg-green-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-green-400 dark:hover:bg-gray-700"
              >
                Upgrade
              </Link>
            )}
            {!isOnLoginPage && (
              <Link
                to={LOGIN_PATH}
                className="rounded-md px-3 py-1 font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
              >
                Sign in
              </Link>
            )}
          </>
        )}

        {authState.status === 'authenticated' && (
          <>
            {/* What a screen reader hears, unchanged by story 59.3: "Account
              status, {email}, Premium". The VISIBLE email moved into the
              account-menu trigger, which cannot live in this region, so the
              region keeps an `sr-only` copy. The email ONLY, not "Signed in
              as …": the announcement stays exactly what it was. */}
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
    </div>
  )
}

/**
 * The trigger: `[avatar] [email] [chevron]`.
 *
 * `min-h-[1.75rem]` + `px-2` give the BUTTON a box of at least 28px tall and
 * 24 + 16 = 40px wide, the project's 28px target floor. The avatar is not
 * enlarged.
 *
 * ⚠️ 28px, not the 32px (`min-h-[2rem]`) the story first specified. Below
 * 640px the strip is 32px INCLUDING its 1px bottom border, so it has 31px of
 * content height. A 32px trigger cannot fit and grows the strip. See the status
 * region's `max-sm:min-h-[calc(2rem-1px)]` for the measurement. `min-w-0` lets the button shrink so the email inside it can
 * truncate on a narrow desktop row. Raw `gray-*`/`green-*` with `dark:`
 * variants, not semantic tokens: this chrome follows `GlobalNav.tsx`'s
 * convention (UX record 2026-09-21, §6).
 */
const ACCOUNT_TRIGGER_CLASS =
  'flex min-h-[1.75rem] min-w-0 items-center gap-2 rounded-md px-2 font-medium text-gray-900 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-gray-100 dark:hover:bg-gray-700'

const ACCOUNT_EMAIL_CLASS = 'min-w-0 truncate'

/**
 * Hide the trigger's email from 640px to below 660px, for a PREMIUM user only
 * (decision D2, Lucas 2026-09-22: hide it wherever it measures under 24px).
 *
 * The measured widths live in ONE place, `e2e/account-menu.paid.spec.ts`; they
 * are deliberately not restated here (review caught three copies of them, which
 * is how the nav's width figures went stale three times).
 *
 * ⚠️ The breakpoint is derived from the CI font (DejaVu, what `system-ui`
 * resolves to on the runners), which is the reference this project measures
 * against. Under a narrower dev font the same viewport shows a little more
 * email, so between 640px and 660px this hides an email that would have been
 * marginally over the 24px line there. That is the accepted cost of a static
 * breakpoint; the alternative is a container query, which Tailwind 3.4 has no
 * variant for here.
 *
 * Premium only, because the pill is what takes the room: without it the email
 * gets about 80px more, legible at every desktop width. And it is the room
 * that is fixed, not the email: at 640px ANY email gets those 10px, so a short
 * address would be clipped just the same. The trigger is then `[A ▾]`; the
 * email is still announced by the status region and shown in the panel.
 *
 * ⚠️ `659.98px`, not `660px`: Tailwind's `max-[660px]` is INCLUSIVE of 660px
 * (measured: the email was hidden at exactly 660px, where it has 30px).
 */
const NARROW_PREMIUM_HIDE = 'sm:max-[659.98px]:hidden'

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
 * The one row. `py-2 text-sm` makes it about 36px tall, like `NAV_LINK_BASE`,
 * over the 28px floor. The ring is inset so the panel's edge cannot clip it.
 */
const SIGN_OUT_CLASS =
  'block w-full px-4 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 disabled:cursor-wait disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'

/**
 * The account menu (story 59.3, FR99): a signed-in user signs out here.
 *
 * Mounted ONLY in the authenticated branch. So the open state cannot survive
 * a sign-out and come back open at the next sign-in: leaving the branch
 * unmounts this component and its state with it.
 *
 * ⚠️ A DISCLOSURE, not a menu (UX record 2026-09-21, §4). No `role="menu"`
 * and no `aria-haspopup`: one action and a line of static text do not clear
 * the bar for the menu pattern, and `switch-profile.tsx`'s `aria-haspopup`
 * without a menu panel is the precedent NOT to copy.
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
 * ⚠️⚠️ `aria-label="Account menu"`, EXACTLY, and the visible email is NOT part
 * of the name. This is a KNOWN, ACCEPTED failure of WCAG 2.5.3 (Label in Name,
 * Level A): a voice-control user who says the visible email cannot activate
 * this control. **Raised by story 59.3's code review and ACCEPTED by Lucas on
 * 2026-09-22**, on the epic's original reasoning (FR99): the email is an
 * identity readout that the status region beside this already announces, and
 * the affordance itself is the avatar + chevron.
 *
 * It is recorded as an accepted cost in `_bmad-output/planning-artifacts/
 * epics.md` (FR99) and in `deferred-work.md`, so it is findable by an
 * accessibility audit rather than only by reading this file. Do NOT "fix" it in
 * passing: putting the email into the name reverses a product decision, and if
 * it is ever reversed, every probe that names this control moves to a
 * `/^Account menu/` regex in the same change.
 *
 * ⚠️ The justification this comment used to give was FALSE and was corrected in
 * review: "`getByRole`'s `name` is a full-string match" is true of
 * testing-library and NOT of Playwright, which compiles a non-`exact` name to
 * `"value"i`, a case-insensitive SUBSTRING (verified in playwright-core
 * 1.61.1, `coreBundle.js` `getByRoleSelector` / `escapeForAttributeSelector`).
 * A compound name would therefore still match `/^Account menu/`-style probes.
 * The name is what it is by decision, not because tooling forces it.
 *
 * The dismissal machinery mirrors `GlobalNav.tsx`'s More disclosure, in
 * spirit and on purpose NOT `switch-profile.tsx`'s: Escape and an outside
 * press close it, focus returns to the trigger only when nothing else has
 * claimed it, the document listeners exist only while open, and any pathname
 * change closes it. Copied rather than shared, because extracting a hook would
 * reopen `GlobalNav.tsx`, which this story has no other reason to touch. A
 * shared hook is logged in `deferred-work.md`.
 */
function AccountMenu({
  email,
  isPremium,
  pathname,
}: {
  email: string
  isPremium: boolean
  pathname: string
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
    // `min-w-0` so the trigger (and the email in it) can shrink. `sm:relative`
    // makes this the box the desktop panel hangs from; below 640px it is not
    // positioned, so the panel resolves against the full-width strip instead.
    <div ref={menuRef} className="flex min-w-0 sm:relative">
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
        <span
          className={
            isPremium ? `${ACCOUNT_EMAIL_CLASS} ${NARROW_PREMIUM_HIDE}` : ACCOUNT_EMAIL_CLASS
          }
        >
          {email}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform dark:text-gray-400${
            isOpen ? ' rotate-180' : ''
          }`}
        />
      </button>
      {isOpen && (
        <div id={panelId} className={ACCOUNT_PANEL_CLASS}>
          <p className="px-4 py-2 text-gray-600 dark:text-gray-300">
            {'Signed in as '}
            <span className="break-all font-medium text-gray-900 dark:text-gray-100">{email}</span>
          </p>
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

// Hand-rolled inline SVG, the app's house style (there is no icons package;
// see the note above `GlobalNav.tsx`'s icon components).
function ChevronDownIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}
