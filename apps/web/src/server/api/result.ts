/**
 * The shared shape every server API function returns.
 *
 * This module exists because the interface was once declared TWICE, identically
 * (in `api/auth/paddle.ts` and a since-deleted `api/calculations/retirement.ts`),
 * and an `api/index.ts` barrel re-exported both with `export *`, so the name was
 * ambiguous (TS2308) and the copies could drift. Story 78.1 deleted that barrel
 * and the retirement module (nothing imported either); `auth/paddle.ts` still
 * re-exports this one declaration for its importers.
 */
export interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}
