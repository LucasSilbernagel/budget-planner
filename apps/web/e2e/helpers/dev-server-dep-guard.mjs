/**
 * Runs `pnpm dev` for the e2e suite and records any runtime dependency
 * re-optimization that reloads the page (story 85.2, FR138).
 *
 * ⚠️ When Vite meets a dependency its start-up scan missed, it optimizes it on
 * the fly, and if the new bundle changes existing chunks it FULL-RELOADS every
 * open page ("✨ optimized dependencies changed. reloading"). In e2e that reload
 * lands in the middle of whichever tests are running. On CI's cold
 * `node_modules/.vite` it was the cause of the e2e flakes that `retries: 1` hid
 * (85.2 `causes.md`: `workbox-window`, imported at runtime by
 * `virtual:pwa-register`). `vite.config.ts` pre-bundles it now. This wrapper
 * makes the NEXT such dependency fail the run instead of flaking it:
 * `e2e/global-teardown.ts` fails if the log written here is non-empty.
 *
 * Only the RELOAD line counts. Vite also prints "new dependencies optimized"
 * when a late dependency changes nothing and nothing reloads (vite 7.3.6,
 * `logNewlyDiscoveredDeps`, 85.2 review P1). That is harmless and must not
 * fail a run.
 *
 * Usage: node e2e/helpers/dev-server-dep-guard.mjs <port>
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const port = process.argv[2]
if (!port) {
  console.error('usage: dev-server-dep-guard.mjs <port>')
  process.exit(2)
}

// Keep in step with `depReloadLogPath` in e2e/global-teardown.ts.
const logFile = join(tmpdir(), 'budget-planner-e2e', `dep-reload-${port}.log`)

// A guard that can't write its log has silently stopped guarding, so a
// filesystem error ends the run loudly instead (85.2 review P7).
function failLoudly(error) {
  console.error(`[dev-server-dep-guard] cannot write ${logFile}: ${error}`)
  process.exit(1)
}

try {
  mkdirSync(join(tmpdir(), 'budget-planner-e2e'), { recursive: true })
  // Truncate: this server's run starts clean.
  writeFileSync(logFile, '')
} catch (error) {
  failLoudly(error)
}

const RELOAD = /optimized dependencies changed\. reloading/

const child = spawn('pnpm', ['dev', '--port', port, '--strictPort'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  // `pnpm` is `pnpm.cmd` on Windows, which only a shell can run.
  shell: process.platform === 'win32',
})
child.on('error', (error) => {
  console.error(`[dev-server-dep-guard] could not start pnpm dev: ${error}`)
  process.exit(1)
})

// Line by line, so a reload line split across two pipe reads still matches
// (85.2 review P8).
for (const [stream, sink] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY }).on('line', (line) => {
    sink.write(`${line}\n`)
    if (!RELOAD.test(line)) return
    try {
      appendFileSync(logFile, `${line}\n`)
    } catch (error) {
      child.kill('SIGTERM')
      failLoudly(error)
    }
  })
}

// `close`, not `exit`: `exit` can fire before the pipes are drained, which
// dropped the tail of the output (85.2 review P6, measured).
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
