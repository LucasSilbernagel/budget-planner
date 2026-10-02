/**
 * Runs `pnpm dev` for the e2e suite and records any runtime dependency
 * re-optimization (story 85.2, FR138).
 *
 * ⚠️ When Vite meets a dependency its start-up scan missed, it optimizes it on
 * the fly and FULL-RELOADS every open page ("✨ optimized dependencies changed.
 * reloading"). In e2e that reload lands in the middle of whichever tests are
 * running. On CI's cold `node_modules/.vite` it was the cause of the
 * `account-menu`, `clear-local-data` and `forecasting-seed` flakes that
 * `retries: 1` hid (85.2 `causes.md`: `workbox-window`, imported at runtime by
 * `virtual:pwa-register`). `vite.config.ts` pre-bundles it now. This wrapper
 * makes the NEXT such dependency fail the run instead of flaking it:
 * `e2e/global-teardown.ts` fails if the log written here is non-empty.
 *
 * Usage: node e2e/helpers/dev-server-dep-guard.mjs <port>
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = process.argv[2]
if (!port) {
  console.error('usage: dev-server-dep-guard.mjs <port>')
  process.exit(2)
}

// Keep in step with `depReloadLogPath` in e2e/global-teardown.ts.
const logDir = join(tmpdir(), 'budget-planner-e2e')
const logFile = join(logDir, `dep-reload-${port}.log`)
mkdirSync(logDir, { recursive: true })
// Truncate: this server's run starts clean.
writeFileSync(logFile, '')

const RELOAD = /optimized dependencies changed|new dependencies optimized/

const child = spawn('pnpm', ['dev', '--port', port, '--strictPort'], {
  stdio: ['inherit', 'pipe', 'pipe'],
})
for (const [stream, sink] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  stream.on('data', (chunk) => {
    sink.write(chunk)
    const text = chunk.toString()
    if (RELOAD.test(text)) appendFileSync(logFile, text)
  })
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
