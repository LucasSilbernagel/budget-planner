// Types for `client-bundle-guard-lib.mjs`, so its unit suite
// (`src/__tests__/client-bundle-guard.test.ts`) can import it typed (the
// `icons-lib.d.mts` precedent).

export const SERVER_ONLY_MARKERS: readonly string[]

export function checkClientBundle(
  distRoot: string,
  markers?: readonly string[]
): { ok: boolean; problems: string[] }
