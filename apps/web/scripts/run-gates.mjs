// Exit 0 only when every gate is green, 1 when any is not, 2 when the run can't start,
// 130 when interrupted. If a gate fails here but passes alone, try --sequential.

import { execFileSync, spawn } from 'node:child_process'
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
} from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
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
	USAGE,
	verdict,
} from './gates-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const WORKSPACE_DIRS = ['apps', 'packages']
const KILL_GRACE_MS = 5_000

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
 * Probes both loopbacks: `vite dev` listens on `localhost` (IPv6-only here), while the
 * prod server binds 127.0.0.1.
 */
async function portInUse(port) {
	const [v4, v6] = await Promise.all([probe(port, '127.0.0.1'), probe(port, '::1')])
	return v4 || v6
}

async function takenPort(gate) {
	for (const port of gate.ports ?? []) {
		if (await portInUse(port)) return port
	}
	return null
}

const portMessage = (port) =>
	`Port ${port} is in use. Playwright would reuse that server and test its code, not this tree. ` +
	`Stop it first (find it with: ss -tlnp | grep :${port}).`

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
 * Killing the process group isn't enough: Playwright's webServers get their own groups.
 * Snapshot the tree, SIGINT, then after a grace period SIGKILL a fresh snapshot's union.
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

function killEverything() {
	for (const child of live) {
		const tree = descendants(child.pid)
		killGroup(child, 'SIGKILL')
		for (const pid of tree) signalPid(pid, 'SIGKILL')
	}
}

/** Own process group, so its dev servers and workers can be killed with it. */
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
			appendFileSync(logPath, `\n[run-gates] spawn failed: ${command}: ${error.message}\n`)
			settle({ exitCode: null, signal: null, timedOut, spawnError: error.message })
		})
		child.once('close', (exitCode, signal) => {
			// The leader may exit before its children: nothing in the group may outlive the gate.
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
	// Re-probed here: a server started during phase A would otherwise be reused silently.
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

	// A stray server on a Playwright port is silently reused, so e2e would test whatever it
	// runs. Refuse before spending minutes on phase A.
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
	// The gates are detached, so a closed terminal doesn't reach them; without this the
	// Playwright servers would be orphaned.
	process.on('SIGHUP', () => interrupt('SIGHUP'))

	// A phase A failure stops the run: everything after would measure a missing or stale build.
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
