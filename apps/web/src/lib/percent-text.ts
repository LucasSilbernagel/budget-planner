/**
 * A typed percentage with its decimal comma read as a point (Story 110.1, FR178).
 *
 * D3 (Lucas 2026-10-06): a SINGLE `,` is the decimal point in every percent field,
 * whatever the locale. A percent has no thousands grouping, so a lone comma is
 * never a group separator: `2,5` → `2.5`, `2,5%` → `2.5%`.
 *
 * Only text with exactly one `,` and no `.` converts. Anything else comes back
 * unchanged, so `1.000,5`, `1,000.5` and `2,5,1` still carry a comma and each
 * field's existing strict check refuses them. Convert BEFORE that check and before
 * `parseFloat`: `parseFloat('2,5')` reads the prefix, 2.
 *
 * Accepted consequence: `1,000` reads as 1%, not 1000%. Every percent field's
 * sane range is far below 1000%.
 */
export function decimalCommaToPoint(raw: string): string {
  const commas = raw.split(',').length - 1
  return commas === 1 && !raw.includes('.') ? raw.replace(',', '.') : raw
}
