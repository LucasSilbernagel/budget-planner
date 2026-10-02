// Runs every gate and prints one line per gate (story 82.1, FR133).
//
//   pnpm gates                     # all gates: phase A in order, phase B at once
//   pnpm gates --sequential        # phase B one at a time (the fallback)
//   pnpm gates --only core,web     # a subset (phase A comes along when needed)
//
// Exit 0 only when every gate is GREEN (see `verdict` in `gates-lib.mjs`),
// 1 when any gate is not, 2 when the run cannot start (a port is taken, a bad
// flag), 130 when interrupted. Each gate's full output goes to a per-run
// directory outside the repo; the path is printed first and last.
//
// ⚠️ Whether the phase B gates interfere with each other was NOT measured when
// this landed (story 82.1, D8). If a gate fails here and passes alone, run
// `--sequential`, and record it in deferred-work.md as N failures of M runs.

import { execFileSync, spawn } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  USAGE,
  aggregateParts,
  buildGates,
  formatDuration,
  formatLine,
  parseArgs,
  screenshotNotice,
  selectGates,
  spawnEnv,
  treeOf,
  typeCheckScriptsOf,
  verdict,
} from './gates-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
/** Where workspace packages live (`pnpm-workspace.yaml`). */
const WORKSPACE_DIRS = ['apps', 'packages']
const KILL_GRACE_MS = 5_000

/** Every workspace package with its scripts, read from disk. */
function workspacePackages() {
  return WORKSPACE_DIRS.flatMap((parent) =>
    readdirSync(join(ROOT, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name))
      .filter((dir) => existsSync(join(ROOT, dir, 'package.json')))
      .map((dir) => ({
        dir,
        scripts: JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')).scripts,
      }))
  )
}

function probe(port, host) {
  return new Promise((done) => {
    const socket = connect({ port, host })
    const finish = (inUse) => {
      socket.destroy()
      done(inUse)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(1_000, () => finish(false))
  })
}

/**
 * True when something accepts a connection on the port, on EITHER loopback.
 *
 * ⚠️ Both are needed: `vite dev` listens on `localhost`, which resolves to `::1`
 * here, so its servers are IPv6-only (MEASURED in review, story 82.1), while
 * the prod server binds `127.0.0.1`. Playwright's reuse check requests
 * `http://localhost:<port>` and finds either.
 */
async function portInUse(port) {
  const [v4, v6] = await Promise.all([probe(port, '127.0.0.1'), probe(port, '::1')])
  return v4 || v6
}

/** The first taken port of a gate, or null. */
async function takenPort(gate) {
  for (const port of gate.ports ?? []) {
    if (await portInUse(port)) return port
  }
  return null
}

const portMessage = (port) =>
  `Port ${port} is in use. Playwright would reuse that server and test its code, not this tree. ` +
  `Stop it first (find it with: ss -tlnp | grep :${port}).`

/** Every gate process still running, so an interrupt can stop them all. */
const live = new Set()
/** Pending SIGKILL fallbacks: the runner must not exit before they fire. */
const stopping = []

function signalPid(pid, signal) {
  try {
    process.kill(pid, signal)
  } catch {
    // Already gone.
  }
}

function killGroup(child, signal) {
  signalPid(-child.pid, signal)
}

let psWarned = false
/** Every process descended from `pid`, whatever its process group. */
function descendants(pid) {
  try {
    return treeOf(execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }), pid)
  } catch (error) {
    if (!psWarned) {
      psWarned = true
      console.error(
        `WARNING: cannot list processes (${error.message}). Playwright's servers may survive a stop: check ports 5173-5176 and 55432.`
      )
    }
    return []
  }
}

/**
 * Stops a gate and everything it started.
 *
 * ⚠️ Killing the gate's process group is NOT enough. Playwright starts each
 * `webServer` in a process group of its own, so its three servers are outside
 * the gate's group, and Playwright does not stop them on SIGTERM. MEASURED
 * (story 82.1, Task 5): an interrupted run left :5173, :5174 and :5175 held,
 * and the next e2e run would have silently REUSED the two dev servers. So:
 * snapshot the whole process tree (after the leader dies, orphans are
 * reparented and can no longer be found), send SIGINT (Playwright's graceful
 * shutdown stops its servers), then, after a grace period, snapshot again (a
 * server may have been forked after the first snapshot) and SIGKILL the union.
 */
function stopGate(child) {
  const first = descendants(child.pid)
  killGroup(child, 'SIGINT')
  for (const pid of first) signalPid(pid, 'SIGINT')
  const done = new Promise((resolve) =>
    setTimeout(() => {
      const tree = new Set([...first, ...descendants(child.pid)])
      killGroup(child, 'SIGKILL')
      for (const pid of tree) signalPid(pid, 'SIGKILL')
      resolve()
    }, KILL_GRACE_MS)
  )
  stopping.push(done)
  return done
}

/** Immediate SIGKILL of everything live (a second Ctrl-C, or a crash). */
function killEverything() {
  for (const child of live) {
    const tree = descendants(child.pid)
    killGroup(child, 'SIGKILL')
    for (const pid of tree) signalPid(pid, 'SIGKILL')
  }
}

/**
 * Runs one command in its own process group (so its dev servers and workers
 * can be killed with it), output to `logPath`.
 */
function runProcess({ cwd, command, args, env, timeoutMs, logPath }) {
  return new Promise((done) => {
    const fd = openSync(logPath, 'a')
    const child = spawn(command, args, {
      cwd,
      env: spawnEnv(process.env, env),
      stdio: ['ignore', fd, fd],
      detached: true,
    })
    closeSync(fd)
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      stopGate(child)
    }, timeoutMs)
    const settle = (outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      live.delete(child)
      done(outcome)
    }
    if (child.pid) live.add(child)
    child.once('error', (error) => {
      // ENOENT/EACCES: the command never ran, so the log is empty. Say why in it.
      appendFileSync(logPath, `\n[run-gates] spawn failed: ${command}: ${error.message}\n`)
      settle({ exitCode: null, signal: null, timedOut, spawnError: error.message })
    })
    child.once('close', (exitCode, signal) => {
      // The leader may exit before its children (a dev server Playwright started):
      // make sure nothing in the group outlives the gate.
      killGroup(child, 'SIGKILL')
      settle({ exitCode, signal, timedOut })
    })
  })
}

function readSummary(gate, logPath) {
  const source = gate.parse.from === 'log' ? logPath : gate.parse.from
  if (!existsSync(source)) return null
  return gate.parse.fn(readFileSync(source, 'utf8'))
}

async function runGateUnsafe(gate, runDir, { sequential }) {
  const started = Date.now()
  // Re-probed here, not only at start-up: phase A takes a while, and a server
  // (or a second runner) started meanwhile would otherwise be reused silently.
  const port = await takenPort(gate)
  if (port !== null) {
    appendFileSync(join(runDir, `${gate.id}.log`), `${portMessage(port)}\n`)
    return { id: gate.id, ms: 0, exitCode: null, summary: null, spawnError: `port ${port} in use` }
  }
  if (gate.parts) {
    const runPart = async (part, index) => {
      const logPath = join(runDir, `${gate.id}-${index}.log`)
      const outcome = await runProcess({ ...part, timeoutMs: gate.timeoutMs, logPath })
      return { ...outcome, summary: readSummary(gate, logPath) }
    }
    const parts = []
    if (sequential) {
      for (const [index, part] of gate.parts.entries()) parts.push(await runPart(part, index))
    } else {
      parts.push(...(await Promise.all(gate.parts.map(runPart))))
    }
    return { id: gate.id, ms: Date.now() - started, ...aggregateParts(parts) }
  }
  const logPath = join(runDir, `${gate.id}.log`)
  const outcome = await runProcess({ ...gate, logPath })
  return {
    id: gate.id,
    ms: Date.now() - started,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    spawnError: outcome.spawnError ?? null,
    summary: readSummary(gate, logPath),
  }
}

/** Never rejects: a runner bug in one gate is that gate's red line, not a lost run. */
async function runGate(gate, runDir, options) {
  try {
    return await runGateUnsafe(gate, runDir, options)
  } catch (error) {
    return {
      id: gate.id,
      ms: 0,
      exitCode: null,
      summary: null,
      spawnError: `runner error: ${error.message}`,
    }
  }
}

/** The working tree's changed and untracked files, repo-relative; [] if git fails. */
function changedFiles() {
  try {
    const git = (args) =>
      execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    return [
      ...git(['diff', '--name-only', 'HEAD']),
      ...git(['ls-files', '--others', '--exclude-standard']),
    ]
  } catch {
    return []
  }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`)
    process.exit(2)
  }
  if (options.help) {
    console.log(USAGE)
    process.exit(0)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = join(tmpdir(), 'budget-planner-gates', stamp)
  mkdirSync(runDir, { recursive: true })

  let gates
  try {
    gates = selectGates(
      buildGates({
        root: ROOT,
        runDir,
        typeCheckScripts: typeCheckScriptsOf(workspacePackages()),
      }),
      options.only
    )
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }

  // A stray server on a Playwright port is SILENTLY reused by the dev-server
  // projects (`reuseExistingServer: !CI`), so e2e would test whatever that
  // server runs, not this tree. Refuse before spending minutes on phase A; the
  // gate re-probes right before it starts, too.
  for (const gate of gates) {
    const port = await takenPort(gate)
    if (port !== null) {
      console.error(portMessage(port))
      process.exit(2)
    }
  }

  const e2eSelected = gates.some((gate) => gate.id === 'e2e')
  const notice = [...screenshotNotice({ e2e: e2eSelected, changedFiles: changedFiles() })]
  console.log(`Gate logs: ${runDir}`)
  console.log(`Mode: ${options.sequential ? 'sequential' : 'phase B concurrent'}`)
  for (const line of notice) console.log(line)
  console.log('')

  const results = new Map()
  let interrupted = false
  const report = (result) => {
    // A gate that finished after an interrupt was stopped, whatever it printed:
    // vitest can exit 0 with a partial report after SIGINT.
    const final = interrupted && !result.skipped ? { ...result, interrupted: true } : result
    results.set(final.id, final)
    console.log(formatLine(final))
  }
  const skip = (gate, why) =>
    report({ id: gate.id, exitCode: null, summary: null, ms: 0, skipped: why })
  const started = Date.now()

  const interrupt = (signal) => {
    if (interrupted) {
      // A second signal: stop waiting for a graceful shutdown.
      console.error(`\n${signal} again: killing everything now.`)
      killEverything()
      process.exit(130)
    }
    interrupted = true
    console.error(`\n${signal}: stopping every running gate (again to force)...`)
    for (const child of live) stopGate(child)
  }
  process.on('SIGINT', () => interrupt('SIGINT'))
  process.on('SIGTERM', () => interrupt('SIGTERM'))
  // The gates are detached (their own sessions), so a closed terminal does not
  // reach them: without this, the Playwright servers would be orphaned.
  process.on('SIGHUP', () => interrupt('SIGHUP'))

  // Phase A: in order; a failure stops the run, since everything after it
  // would be measuring a missing or stale build.
  let phaseAFailed = null
  const stopReason = () => (interrupted ? 'interrupted' : `${phaseAFailed} failed`)
  for (const gate of gates.filter((g) => g.phase === 'A')) {
    if (phaseAFailed || interrupted) {
      skip(gate, stopReason())
      continue
    }
    const result = await runGate(gate, runDir, options)
    report(result)
    if (!verdict(result).green) phaseAFailed = gate.id
  }

  const phaseB = gates.filter((g) => g.phase === 'B')
  if (phaseAFailed || interrupted) {
    for (const gate of phaseB) skip(gate, stopReason())
  } else if (options.sequential) {
    for (const gate of phaseB) {
      if (interrupted) skip(gate, 'interrupted')
      else report(await runGate(gate, runDir, options))
    }
  } else {
    await Promise.all(phaseB.map(async (gate) => report(await runGate(gate, runDir, options))))
  }

  const all = [...results.values()]
  const failed = all.filter((r) => r.skipped || !verdict(r).green)
  const headline = interrupted
    ? 'INTERRUPTED: no verdict'
    : failed.length === 0
      ? 'ALL GATES GREEN'
      : `${failed.length} GATE(S) NOT GREEN: ${failed.map((r) => r.id).join(', ')}`
  console.log(`\n${headline} in ${formatDuration(Date.now() - started)}`)
  for (const line of notice) console.log(line)
  console.log(`Gate logs: ${runDir}`)
  await Promise.all(stopping)
  process.exit(interrupted ? 130 : failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  killEverything()
  console.error(error)
  process.exit(2)
})
