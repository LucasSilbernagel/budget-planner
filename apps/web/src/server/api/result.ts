/**
 * The shared shape every server API function returns.
 *
 * ⚠️ This module exists because the interface was declared TWICE, identically —
 * `api/auth/paddle.ts` and `api/calculations/retirement.ts` — and `api/index.ts`
 * re-exports both barrels with `export *`, so the name was ambiguous (TS2308) and
 * the two copies could have drifted apart without anything noticing. One
 * declaration, re-exported from both, keeps the barrel unambiguous and makes
 * divergence impossible.
 */
export interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}
