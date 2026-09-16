// @ts-check
/**
 * Container entrypoint switch (Story 5-18, AC-2).
 *
 * One image both serves traffic and applies migrations, because DanubeData
 * Rapids is Knative Serving: it offers no run-to-completion job, no
 * `--command`/`--args` override, and `--env` on `rapids update` is the only
 * configuration surface a pipeline can reach (verified against
 * `@danubedata/cli@1.1.0`, story 5-18 D1). An environment variable read once at
 * boot is therefore the only lever available — and it is read HERE, at boot, not
 * by a route and not per request, so no HTTP input can ever select the migrate
 * path.
 *
 * Fail-safe direction is deliberate: anything that is not the exact opt-in
 * string keeps SERVING. A near-miss that silently migrated instead of serving
 * would take the site down for every user; a near-miss that serves instead of
 * migrating is caught immediately by the pipeline, which polls for a positive
 * migration verdict and fails closed without one.
 */

/** The one value that selects migrate mode. Exact match, no trimming, no casefold. */
export const MIGRATE_ENTRYPOINT = 'migrate'

/**
 * @param {Record<string, string | undefined>} env
 * @returns {'migrate' | 'serve'}
 */
export function selectEntrypoint(env) {
  return env['APP_ENTRYPOINT'] === MIGRATE_ENTRYPOINT ? 'migrate' : 'serve'
}
