/** Ids are minted on the client so a record created offline has the same id on every device. */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Legacy rows have negative-integer ids, which the server's uuid column rejects and pulls
 * can never match; the persist `migrate` hook reassigns them.
 */
export function withUuidIds<T extends { id: unknown }>(items: readonly T[] | undefined): T[] {
  if (!items) {
    return []
  }
  return items.map((item) => (typeof item.id === 'string' ? item : { ...item, id: generateUUID() }))
}
