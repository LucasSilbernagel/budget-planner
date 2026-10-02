import { existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Fails the run if a dev server re-optimized a dependency mid-suite (story 85.2,
 * FR138). See `e2e/helpers/dev-server-dep-guard.mjs` for why: that reload
 * lands inside whichever tests are running and shows up as flakes that
 * `retries: 1` hides.
 *
 * Only logs written during THIS run count. A reused local server
 * (`reuseExistingServer`) never goes through the wrapper, so its old log is
 * ignored by the mtime check rather than failing a run it didn't touch.
 */
export const depReloadLogPath = (port: number) =>
  join(tmpdir(), 'budget-planner-e2e', `dep-reload-${port}.log`)

export const DEV_SERVER_PORTS = [5173, 5174] as const

export default function globalTeardown(): void {
  const runStartedAt = Number(process.env['E2E_RUN_STARTED_AT'] ?? 0)
  const hits = DEV_SERVER_PORTS.flatMap((port) => {
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
