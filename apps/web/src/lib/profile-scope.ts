/**
 * A null/absent profileId is unscoped and visible under every profile (legacy rows have none).
 * A null active profile keeps every row.
 */

export interface ProfileScoped {
  profileId?: string | null
}

export function isInActiveProfile(
  rowProfileId: string | null | undefined,
  activeProfileId: string | null
): boolean {
  if (activeProfileId === null || rowProfileId === null || rowProfileId === undefined) {
    return true
  }
  return rowProfileId === activeProfileId
}

/** Returns a new array: never return it from a zustand selector; derive in useMemo. */
export function scopeToActiveProfile<T extends ProfileScoped>(
  rows: readonly T[],
  activeProfileId: string | null
): T[] {
  return rows.filter((row) => isInActiveProfile(row.profileId, activeProfileId))
}
