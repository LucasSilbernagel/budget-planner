/**
 * "Has the client taken over yet?" — the gate every store-backed figure uses to
 * decide between a skeleton and a number (story 38.2, UX-DR43).
 *
 * ## ⚠️ Why this is a mount gate and NOT `persist.hasHydrated()`
 *
 * The obvious signal is the wrong one, and using it re-creates BUG-F — the
 * defect story 38.1 spent a whole story removing.
 *
 * `StoreHydration` (`lib/store-hydration.tsx`) sits in the ROOT subtree, while
 * route content sits inside the `React.Suspense` boundary
 * `@tanstack/react-router` wraps around the root `<Outlet/>` unconditionally
 * (`Match.js:286-289`). React commits and flushes the root subtree's effects in
 * an EARLIER pass, and `rehydrate()` is synchronous for a synchronous storage,
 * so every store is already full before a single route component renders.
 *
 * MEASURED at `d66c821`, seeded with one savings goal:
 *
 * ```
 * StoreHydration EFFECT START            3812.0ms
 * StoreHydration EFFECT END  savings=1   3813.4ms   ← all ten stores, 1.4ms
 * HomePage RENDER   mountGate=false  snapshotSavings=0  liveSavings=1   3829.9ms
 * HomePage RENDER   mountGate=false  snapshotSavings=0  liveSavings=1   3843.9ms
 * HomePage EFFECT   mountGate=false                                     3854.2ms
 * HomePage RENDER   mountGate=true   snapshotSavings=1  liveSavings=1   3858.6ms
 * ```
 *
 * Read the third line: `liveSavings=1` while `snapshotSavings=0`. A
 * `hasHydrated()` call would have returned **true** there — on the server it is
 * false — so gating on it means SERVER: skeleton, FIRST CLIENT RENDER: content.
 * That is a text mismatch on a whole subtree, and `e2e/hydration.spec.ts` fails
 * on it.
 *
 * A `useState` initial value cannot diverge that way: it is `false` on the
 * server and `false` during hydration BY CONSTRUCTION, and the effect that flips
 * it cannot run before the commit. React's own semantics carry the guarantee, so
 * nothing here depends on a snapshot subtlety.
 *
 * ## Why "mounted" is a correct proxy for "the data is here"
 *
 * Only because of the ordering above: a route component's own effect runs AFTER
 * the root subtree's, measured at 3854.2ms vs 3813.4ms — 40.8ms of margin, and
 * the ordering is structural (different hydration passes), not a race.
 *
 * ⚠️ A store whose `rehydrate()` REJECTS (blocked localStorage, corrupt JSON)
 * still resolves this gate, and that is deliberate: `store-hydration.tsx`
 * catches per store and leaves it at its default, so the user sees the genuine
 * empty state rather than a skeleton that never ends.
 *
 * ## ⚠️ THE PRECONDITION THIS HOOK DEPENDS ON AND CANNOT CHECK
 *
 * **Every persisted store must use a SYNCHRONOUS storage.** All ten do today
 * (zustand's default `createJSONStorage(() => localStorage)`), which is why
 * `StoreHydration`'s single effect fills all of them inline in 1.4 ms and why
 * "mounted" is a sound proxy for "the data is here".
 *
 * Give any store an async storage (IndexedDB, a network-backed persist) and this
 * hook silently becomes wrong: it would flip on mount while that store is still
 * empty, and the confident zero returns for a paint. Nothing in the suite would
 * catch it — `renderToString` runs no effects, RTL flushes them, and the e2e
 * resolved arms await the FINAL text. Raised in code review; recorded here rather
 * than guarded, because guarding it means subscribing to ten stores and this hook
 * deliberately subscribes to none.
 *
 * ⚠️ Related: each consumer owns a private `useState`, so in principle two gates
 * could resolve on different commits. On first hydration every gated component
 * on a page mounts in one commit and shares an effect flush, and after that the
 * module flag below makes later mounts resolve immediately — so the invariant
 * "skeletons on screen ⇒ the status region is present" holds, but by
 * construction rather than by assertion.
 *
 * ## Why the unit suite still passes
 *
 * RTL's `render()` flushes effects inside `act`, so the ~28 test files that
 * render these pages see the resolved output exactly as before. The pending
 * state is therefore observed with `renderToString` (see
 * `components/__tests__/loading-state.dom.test.tsx`) — which is also what the
 * server actually does.
 */

import { useEffect, useState } from 'react'

/**
 * ⚠️ Module-scoped, and it fixes a real regression found in code review.
 *
 * Without it the gate is a fresh `useState(false)` on EVERY mount, including
 * client-side navigations. Navigating `/income` → `/` remounts the Overview
 * pending, so a user whose stores filled minutes ago gets a full page of
 * skeletons and — because the Overview's sections placeholder is sized to the
 * resolved-EMPTY card — replays the ~700px (desktop) / ~1100px (320px)
 * skeleton→charts jump on every single in-app navigation. That jump did not
 * exist before this story.
 *
 * The flag is only ever written from an effect, and effects do not run during
 * `renderToString`, so it is permanently `false` on the server — a server
 * process cannot leak one request's flag into the next request's markup, which
 * would be a hydration mismatch. On the client it flips once, on the first
 * mount of the first gated component, and every later mount starts resolved.
 */
let hydratedOnThisClient = false

export function useStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(hydratedOnThisClient)

  useEffect(() => {
    hydratedOnThisClient = true
    setHydrated(true)
  }, [])

  return hydrated
}

/**
 * Reset the module flag. **Tests only.**
 *
 * ⚠️ Call this in `beforeEach` of any file that mixes `render()` with
 * `renderToString()`. `render()` flushes effects and therefore sets the flag; a
 * later `renderToString()` in the same module instance would then start
 * RESOLVED and the pending assertions would fail for a reason that has nothing
 * to do with the code under test. The failure is loud (red), not silent — but it
 * is order-dependent, which is worse to debug than to prevent.
 */
export function __resetStoresHydratedForTests(): void {
  hydratedOnThisClient = false
}
