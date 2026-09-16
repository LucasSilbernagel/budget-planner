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
  // The abort-before-migrate gate. Refuses anything that is not a clean slate or
  // a journal-tracked database, so a `drizzle-kit push`-built target can never be
  // replayed over (deferred-work.md:643).
  { name: 'preflight', bin: 'tsx', args: ['src/migrate-preflight-cli.ts'] },
  { name: 'migrate', bin: 'drizzle-kit', args: ['migrate'] },
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
