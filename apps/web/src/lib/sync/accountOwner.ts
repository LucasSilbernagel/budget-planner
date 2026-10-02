/**
 * Whose is a local row? (story 86.2, FR140)
 *
 * Every persisted store is shared by whoever uses the browser: signing out
 * resets none of them (`lib/account/sign-out.ts`). So when account B signs in
 * where account A synced before, the stores still hold A's profiles and rows,
 * and each one says whose it is in its `userId`:
 *
 *  - a row a PULL wrote carries its owner's server uuid (A's or B's);
 *  - a row never synced carries a PLACEHOLDER: `0` (financial rows, "free
 *    tier"), `''` (the bootstrap profile, `profileStore` `DEFAULT_PROFILE`),
 *    `'temp-user'` (a profile made on the Profiles page, `create-profile.tsx`)
 *    or nothing at all.
 *
 * A placeholder row is adoptable by whoever signs in (5-15 AC-2: free → paid
 * loses nothing). A row carrying a real id that is not the session's belongs to
 * another account and must never be uploaded into, shown in, or made active in
 * this one.
 *
 * ⚠️ The limit (86.2 D4): a row of A's that was never PULLED BACK carries a
 * placeholder too, whether it was never pushed (offline, refused) or pushed and
 * not yet re-pulled (a successful push never restamps the local row; only the
 * next pull does, up to one poll interval later). Such a row is indistinguishable
 * from a free-tier row, and so is a profile made on the Profiles page
 * (`'temp-user'`) in that window. That residual is recorded in deferred-work.md,
 * not fixed here.
 *
 * Imports nothing, so any module (stores included) may use it.
 */

/** The `userId` values a never-synced row carries, as strings. */
const PLACEHOLDER_OWNERS: ReadonlySet<string> = new Set(['', '0', 'temp-user'])

/** Whether `userId` names a real account other than `sessionUserId`. */
export function isOwnedByAnotherAccount(userId: unknown, sessionUserId: string): boolean {
  const owner = String(userId ?? '')
  return !PLACEHOLDER_OWNERS.has(owner) && owner !== sessionUserId
}
