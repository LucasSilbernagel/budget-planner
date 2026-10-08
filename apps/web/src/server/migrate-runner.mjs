// @ts-check
/** Binaries are spawned directly, not via pnpm: the runtime image has no writable pnpm store. */

/**
 * @typedef {{ name: string, bin: string, args: string[] }} MigrationStep
 * @typedef {{ state: 'succeeded' } | { state: 'failed', failedStep: string, exitCode: number | null, error?: string }} MigrationResult
 */

/** @type {MigrationStep[]} */
export const MIGRATION_STEPS = [
  // One step: the lock CLI holds a PostgreSQL advisory lock, then runs preflight and
  // migrate. Knative can boot two pods at once, so exclusion lives in the database.
  { name: 'migrate', bin: 'tsx', args: ['src/migrate-lock-cli.ts'] },
]

/**
 * @param {{ runStep: (step: MigrationStep) => Promise<number | null> }} options
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

    // `null` means the step died on a signal (an OOM kill reports no exit code),
    // so it must not read as success.
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
