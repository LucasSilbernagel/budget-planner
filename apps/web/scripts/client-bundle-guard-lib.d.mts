// Types for `client-bundle-guard-lib.mjs`, so its unit suite
// (`src/__tests__/client-bundle-guard.test.ts`) can import it typed (the
// `icons-lib.d.mts` precedent).

export const SERVER_ONLY_MARKERS: readonly string[]

export const DEV_ONLY_SEAMS: readonly { readonly marker: string; readonly source: string }[]

export function checkDevSeamsAbsent(
	distRoot: string,
	appRoot: string,
	seams?: readonly { readonly marker: string; readonly source: string }[]
): { ok: boolean; problems: string[] }

export function checkClientBundle(
	distRoot: string,
	markers?: readonly string[]
): { ok: boolean; problems: string[] }
