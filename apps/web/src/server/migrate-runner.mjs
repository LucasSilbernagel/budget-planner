// @ts-check
/**
 * The in-cluster migration sequence (Story 5-18, AC-3, AC-4).
 *
 * Runs exactly what the windowed path ran, in the same order and with the same
 * meaning — the 4-17 clean-slate preflight, then `drizzle-kit migrate` — so this
 * story changes WHERE migrations run, never WHAT runs or what it refuses. Both
 * are spawned as the workspace's own binaries rather than through `pnpm`: the
 * runtime image invokes `node` directly so it needs no writable pnpm store
 * (apps/web/Dockerfile), and shelling out to `pnpm` would reintroduce exactly
 * that requirement.
 *
 * `runStep` is injected so the sequencing — in particular "a refused preflight
 * never reaches drizzle-kit" — is testable without spawning a process.
 */

/**
 * @typedef {{ name: string, bin: string, args: string[] }} MigrationStep
 * @typedef {{ state: 'succeeded' } | { state: 'failed', failedStep: string, exitCode: number | null, error?: string }} MigrationResult
 */

/**
 * The two steps, in order. Both run with `cwd` = `packages/db`, which is where
 * `drizzle.config.ts` and `migrations/` live.
 *
 * @type {MigrationStep[]}
 */
export const MIGRATION_STEPS = [
  // ONE step, which internally holds a PostgreSQL advisory lock and then runs
  // preflight -> drizzle-kit migrate (packages/db/src/migrate-lock-cli.ts).
  //
  // ⚠️ These used to be two steps spawned from here. Live run 35042874267-1
  // (2026-09-16) started TWO Knative revisions of this container, and both ran
  // the preflight AND `drizzle-kit migrate` against production simultaneously —
  // harmless only because no migrations were pending. `--min-scale 0` does not
  // mean "nothing boots", and no pipeline-side trick reliably prevents a second
  // pod, so the mutual exclusion lives in the database where every pod meets.
  // Ordering now lives inside the lock CLI, under the lock, where it belongs.
  { name: 'migrate', bin: 'tsx', args: ['src/migrate-lock-cli.ts'] },
]

/**
 * @param {object} options
 * @param {(step: MigrationStep) => Promise<number | null>} options.runStep resolves with the exit code, or null if killed by a signal
 * @returns {Promise<MigrationResult>}
 */
export async function runMigration({ runStep }) {
  for (const step of MIGRATION_STEPS) {
    /** @type {number | null} */
    let exitCode
    try {
      exitCode = await runStep(step)
    } catch (error) {
      // A spawn that never starts (a missing binary, say) is a failed migration,
      // not an unhandled rejection that leaves the verdict stuck on `running`.
      return {
        state: 'failed',
        failedStep: step.name,
        exitCode: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    // `null` means the step died on a signal — an OOM kill reports no exit code,
    // and reading "not non-zero" as success would call that a migration.
    if (exitCode !== 0) {
      return {
        state: 'failed',
        failedStep: step.name,
        exitCode,
        error:
          exitCode === null
            ? `${step.name} was killed by a signal`
            : `${step.name} exited with code ${exitCode}`,
      }
    }
  }

  return { state: 'succeeded' }
}
