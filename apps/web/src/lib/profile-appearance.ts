/**
 * Colour and icon for a profile, derived from its id.
 *
 * ## Why this is shared, and what it fixes
 *
 * Two components render a profile avatar. `profiles/profile-list.tsx` hashed the
 * uuid correctly; `profiles/switch-profile.tsx` typed the id as `number` and did
 * `profileId % PROFILE_COLORS.length` — and a profile id has been a uuid STRING
 * since story 5-14. `"a1b2…" % 8` is `NaN`, so `PROFILE_COLORS[NaN]` was
 * `undefined`: every avatar in the switcher rendered with no colour class and no
 * icon. Nothing caught it because `components/profiles/__tests__/profiles-page.test.tsx` mocks
 * `SwitchProfileDropdown` out entirely.
 *
 * One implementation, used by both, so the two cannot drift again.
 *
 * ⚠️ The hash must stay stable: it is what makes a given profile keep the same
 * colour and emoji across renders and devices. Changing the algorithm reshuffles
 * every existing user's avatars.
 *
 * ⚠️ Known related defect, NOT fixed here: `profileStore.ts` mints the default
 * profile's id with `crypto.randomUUID()` at module scope, so the server and the
 * client hash *different* ids for the same "Main Profile" and disagree on its
 * emoji. That is a hydration bug tracked in `deferred-work.md`, not a flaw in
 * this function.
 */

const PROFILE_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-red-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-pink-500',
] as const

const PROFILE_ICONS = ['🏠', '💼', '💰', '🎯', '📈', '🔒', '🌱', '✈️'] as const

/** djb2-style 32-bit hash, stable across engines. */
function hashProfileId(profileId: string): number {
  let hash = 0
  for (let i = 0; i < profileId.length; i++) {
    hash = (hash << 5) - hash + profileId.charCodeAt(i)
    hash |= 0 // keep it a 32-bit integer
  }
  return Math.abs(hash)
}

/** Tailwind background class for this profile's avatar. Never empty. */
export function profileColor(profileId: string): string {
  if (!profileId) return PROFILE_COLORS[0]
  return PROFILE_COLORS[hashProfileId(profileId) % PROFILE_COLORS.length] ?? PROFILE_COLORS[0]
}

/** Emoji for this profile's avatar. Never empty. */
export function profileIcon(profileId: string): string {
  if (!profileId) return PROFILE_ICONS[0]
  return PROFILE_ICONS[hashProfileId(profileId) % PROFILE_ICONS.length] ?? PROFILE_ICONS[0]
}
