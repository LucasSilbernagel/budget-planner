import { existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Fails the run if a dev server reloaded open pages mid-suite after re-optimizing a
// dependency. Only logs written during this run count (reused servers skip the wrapper).
export const depReloadLogPath = (port: number | string) =>
	join(tmpdir(), 'budget-planner-e2e', `dep-reload-${port}.log`)

export default function globalTeardown(): void {
	const startedAt = Number(process.env['E2E_RUN_STARTED_AT'])
	// Not a valid time: count every log rather than silently none.
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
			`A dev server re-optimized a dependency during the run and reloaded every open page. Add the dependency to \`optimizeDeps.include\` in vite.config.ts.\n${hits.join(
				'\n'
			)}`
		)
	}
}
