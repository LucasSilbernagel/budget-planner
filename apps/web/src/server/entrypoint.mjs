// @ts-check
/**
 * Rapids (Knative) has no run-to-completion jobs, so one image serves or migrates via an
 * env var read once at boot. Anything but the exact opt-in keeps serving (fail-safe).
 */

/** Exact match, no trimming, no casefold. */
export const MIGRATE_ENTRYPOINT = 'migrate'

/**
 * @param {Record<string, string | undefined>} env
 * @returns {'migrate' | 'serve'}
 */
export function selectEntrypoint(env) {
	return env['APP_ENTRYPOINT'] === MIGRATE_ENTRYPOINT ? 'migrate' : 'serve'
}
