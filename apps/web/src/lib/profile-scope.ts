/**
 * Active-profile scoping for the financial stores (story 54.4, FR79).
 *
 * The four financial arrays hold rows from EVERY profile this device has seen:
 * a pull is profile-scoped, but a profile switch does not clear the arrays, and
 * FR79 decided it never should (clearing flashes an empty screen and can drop a
 * local write that has not reached the server yet). Reads are scoped instead,
 * through this one predicate, so every selector hook applies the same rule.
 *
 * ⚠️ `null` or an ABSENT `profileId` means UNSCOPED and is visible under every
 * profile — it is never compared for equality. Rows persisted before 54.4 carry
 * no `profileId` at all (the profile used to live only on the sync operation),
 * and hiding them would look like data loss. Same rule, same reasoning as
 * `useCategoriesForActiveProfile` (`hooks/useCategoryLabels.ts`).
 *
 * ⚠️ A `null` ACTIVE profile keeps every row. `profileStore` essentially never
 * holds null, but if it does, showing everything is far better than a blank app.
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

/**
 * The rows visible under the active profile, in their original order.
 *
 * ⚠️ Returns a NEW array. Never call it inside a zustand selector that returns
 * the array — derive in `useMemo` instead (see the store selector hooks). A
 * selector that returns a number computed over it is fine.
 */
export function scopeToActiveProfile<T extends ProfileScoped>(
  rows: readonly T[],
  activeProfileId: string | null
): T[] {
  return rows.filter((row) => isInActiveProfile(row.profileId, activeProfileId))
}
