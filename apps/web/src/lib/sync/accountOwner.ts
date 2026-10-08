/**
 * Never-synced rows carry a placeholder owner and are adoptable by whoever signs in; a real id that isn't
 * the session's belongs to another account. Imports nothing, so stores may use it.
 */

const PLACEHOLDER_OWNERS: ReadonlySet<string> = new Set(['', '0', 'temp-user'])

export function isPlaceholderOwner(userId: unknown): boolean {
  return PLACEHOLDER_OWNERS.has(String(userId ?? ''))
}

export function isOwnedByAnotherAccount(userId: unknown, sessionUserId: string): boolean {
  return !isPlaceholderOwner(userId) && String(userId) !== sessionUserId
}
