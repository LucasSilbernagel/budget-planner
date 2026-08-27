/**
 * Route: /profiles — custom financial profiles (Story 13-3, Premium).
 *
 * `Route` is the ONLY export in this file, deliberately. `ProfilesPage` used to
 * be defined and exported here, and because it was this route's only
 * split-eligible property the router's code splitter bailed out before emitting
 * anything — the whole module stayed in the eager bundle (BUG-C, story 39-1).
 *
 * Unlike `routes/docs/$docId.tsx`, which hit the same defect AND printed a
 * `[tanstack-router]` warning every `pnpm dev`, this route was silent: the
 * plugin records the un-splittable export but returns before the warning when no
 * other property split. A non-route export in a route file is therefore not
 * reliably self-announcing — the warning depends on the rest of the route.
 *
 * The component now lives in
 * `components/profiles/profiles-page.tsx`; the premium gating contract is
 * documented there, and `e2e/profiles-premium.spec.ts` guards the wiring below.
 */

import { ProfilesPage } from '@/components/profiles/profiles-page'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/profiles')({
  component: ProfilesPage,
})
