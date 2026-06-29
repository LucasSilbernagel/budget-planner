/**
 * Client-generatable UUID helper (Story 5-14).
 *
 * Entity primary keys are uuids so a record created offline carries the SAME id on
 * every device (eliminating pull-side duplicate rows). The client mints the id up
 * front with `crypto.randomUUID()` when available, falling back to a v4-shaped
 * generator for environments that lack it.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Persisted-store migration helper (Story 5-14 review P2).
 *
 * Entity ids became client-generated uuid strings. A user who created rows under
 * the OLD scheme has negative-INTEGER ids sitting in localStorage; rehydrated as-is
 * they are a `string`-typed field holding a number, which the server's uuid column
 * rejects on push and `applyServerChanges` can never match on pull (re-creating the
 * very duplicate-on-create bug this story fixes). The zustand `persist` `migrate`
 * hook calls this to reassign a fresh uuid to any item whose id is not already a
 * string, converting legacy local data in place on first load after the upgrade.
 */
export function withUuidIds<T extends { id: unknown }>(items: readonly T[] | undefined): T[] {
  if (!items) {
    return []
  }
  return items.map((item) => (typeof item.id === 'string' ? item : { ...item, id: generateUUID() }))
}
