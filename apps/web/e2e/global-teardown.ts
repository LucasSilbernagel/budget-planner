import { existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Fails the run if a dev server reloaded every open page mid-suite because it
 * re-optimized a dependency (story 85.2, FR138). See
 * `e2e/helpers/dev-server-dep-guard.mjs` for why: that reload lands inside
 * whichever tests are running and shows up as flakes that `retries: 1` hides.
 *
 * Which servers to check comes from `playwright.config.ts`
 * (`E2E_DEV_SERVER_PORTS`, built from the same list that starts them), so a
 * new or renumbered dev server can't be skipped (85.2 review P10).
 *
 * Only logs written during THIS run count. A reused local server
 * (`reuseExistingServer`) never goes through the wrapper, so its old log is
 * ignored by the mtime check rather than failing a run it didn't touch.
 */
export const depReloadLogPath = (port: number | string) =>
  join(tmpdir(), 'budget-planner-e2e', `dep-reload-${port}.log`)

export default function globalTeardown(): void {
  const startedAt = Number(process.env['E2E_RUN_STARTED_AT'])
  // Not a valid time: count every log rather than silently none (85.2 review P9).
  const runStartedAt = Number.isFinite(startedAt) ? startedAt : 0
  const ports = (process.env['E2E_DEV_SERVER_PORTS'] ?? '').split(',').filter(Boolean)
  const hits = ports.flatMap((port) => {
    const file = depReloadLogPath(port)
    if (!existsSync(file) || statSync(file).mtimeMs < runStartedAt) return []
    const text = readFileSync(file, 'utf8').trim()
    return text ? [`:${port}\n${text}`] : []
  })
  if (hits.length > 0) {
    throw new Error(
      `A dev server re-optimized a dependency during the run and reloaded every open page (story 85.2). Add the dependency to \`optimizeDeps.include\` in vite.config.ts.\n${hits.join(
        '\n'
      )}`
    )
  }
}
