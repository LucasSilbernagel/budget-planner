/**
 * Client-generatable UUID helper (Story 5-14).
 *
 * Entity primary keys are uuids so a record created offline carries the SAME id
 * on every device (eliminating pull-side duplicate rows). The client mints the id
 * up front with `crypto.randomUUID()` when available, falling back to a v4-shaped
 * generator for environments that lack it (older runtimes / non-secure contexts).
 */
export function generateUuid(): string {
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
