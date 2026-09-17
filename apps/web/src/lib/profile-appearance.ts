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
 * ## Story 54.2 (FR78): a STORED icon now wins over the hash
 *
 * A profile may carry a chosen `icon` (`userProfiles.icon`, nullable). When it
 * does, {@link resolveProfileIcon} returns it; when it does not — which is every
 * profile until its owner opens the picker — the hash below still decides, so the
 * rollout is invisible to anyone who never chooses one. That is why `profileIcon`
 * keeps its exact behaviour and a NEW function sits beside it rather than
 * replacing it.
 *
 * ⚠️ `icon` has no CHECK constraint in the database (drizzle-kit 0.23 emits none
 * in this repo — see `packages/core/src/sync/types.ts`), so a stored value can be
 * any string. {@link isProfileIcon} is the real enforcement, applied at the render
 * boundary rather than trusted from the row.
 *
 * ⚠️ Colour stays hash-derived and is deliberately NOT selectable (story 54.2
 * scope): the user's report was about icons, and widening it would have pulled a
 * second field through the same schema/sync gates for no asked-for benefit.
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

/**
 * The fixed icon set. Exported since story 54.2 so the picker renders exactly
 * these and nothing else.
 *
 * ⚠️ ORDER IS LOAD-BEARING. `profileIcon` indexes into this array by hash, so
 * reordering it (or adding/removing an entry) changes the avatar of every profile
 * that has not chosen one. `profile-appearance.test.ts` pins two hash outputs as
 * literals to make that go red.
 */
export const PROFILE_ICONS = ['🏠', '💼', '💰', '🎯', '📈', '🔒', '🌱', '✈️'] as const

export type ProfileIcon = (typeof PROFILE_ICONS)[number]

/**
 * Accessible name for each icon (story 54.2).
 *
 * ⚠️ A control whose only content is an emoji has no usable accessible name: a
 * screen reader announces whatever CLDR name the platform happens to carry, which
 * varies by platform and is sometimes just "emoji". The picker therefore labels
 * every option explicitly. Kept beside `PROFILE_ICONS` so the two cannot drift —
 * `Record<ProfileIcon, string>` makes a missing entry a COMPILE ERROR if an icon
 * is ever added.
 */
export const PROFILE_ICON_LABELS: Record<ProfileIcon, string> = {
  '🏠': 'Home',
  '💼': 'Briefcase',
  '💰': 'Money',
  '🎯': 'Target',
  '📈': 'Chart',
  '🔒': 'Lock',
  '🌱': 'Seedling',
  '✈️': 'Plane',
}

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

/** Emoji for this profile's avatar, derived from its id. Never empty. */
export function profileIcon(profileId: string): string {
  if (!profileId) return PROFILE_ICONS[0]
  return PROFILE_ICONS[hashProfileId(profileId) % PROFILE_ICONS.length] ?? PROFILE_ICONS[0]
}

/** Is this one of the eight icons a user is allowed to have chosen? */
export function isProfileIcon(value: unknown): value is ProfileIcon {
  return typeof value === 'string' && (PROFILE_ICONS as readonly string[]).includes(value)
}

/**
 * The emoji to actually render for a profile: its chosen icon when it has a
 * valid one, otherwise the hash-derived fallback (story 54.2, FR78).
 *
 * Every avatar render site goes through this. A profile with `icon: null` — which
 * is every profile until someone picks one — renders exactly what it rendered
 * before this story existed.
 */
export function resolveProfileIcon(profile: { id: string; icon?: string | null }): string {
  return isProfileIcon(profile.icon) ? profile.icon : profileIcon(profile.id)
}
