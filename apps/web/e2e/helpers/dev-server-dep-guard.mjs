// Vite full-reloads every open page when it optimizes a late dependency that changes
// chunks. This logs such reloads so the global teardown fails the run instead of flaking.

// Only the reload line counts: "new dependencies optimized" alone reloads nothing.
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

// Must match `depReloadLogPath` in the global teardown.
const logFile = join(tmpdir(), 'budget-planner-e2e', `dep-reload-${port}.log`)

// A guard that can't write its log has silently stopped guarding, so fail loudly.
function failLoudly(error) {
  console.error(`[dev-server-dep-guard] cannot write ${logFile}: ${error}`)
  process.exit(1)
}

try {
  mkdirSync(join(tmpdir(), 'budget-planner-e2e'), { recursive: true })
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

// Line by line, so a reload line split across two pipe reads still matches.
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

// `close`, not `exit`: `exit` can fire before the pipes drain, dropping the output's tail.
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
