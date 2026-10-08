// A gate is green only when it exited 0 AND its own summary was found, counted at least
// one thing, and nothing failed: several harnesses here have exited 0 without running.

import { join } from 'node:path'

const MINUTE = 60_000

/** Stripped before parsing: an ambient FORCE_COLOR adds them. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

export function stripAnsi(text) {
	return text.replace(ANSI, '')
}

/**
 * Derived from the package's `type-check` script so both check the same programs.
 * `--diagnostics` because `tsc --noEmit` prints nothing on success.
 */
export function typeCheckPrograms(script) {
	if (typeof script !== 'string' || script.trim() === '') {
		throw new Error('type-check script is missing or empty')
	}
	return script.split(' && ').map((part) => {
		const tokens = part.trim().split(/\s+/)
		if (tokens[0] !== 'tsc') {
			throw new Error(`type-check part is not a bare tsc call: "${part.trim()}"`)
		}
		return [...tokens.slice(1), '--diagnostics']
	})
}

/**
 * Counted from per-test `assertionResults`, not the top-level `num*` fields, which
 * disagree with the console. A file failing before collection counts as a failure.
 */
export function parseVitestJson(text) {
	const report = safeJson(text)
	if (!report || !Array.isArray(report.testResults)) return null
	let passed = 0
	let failed = 0
	let skipped = 0
	for (const file of report.testResults) {
		const tests = Array.isArray(file.assertionResults) ? file.assertionResults : []
		let fileFailures = 0
		for (const test of tests) {
			if (test.status === 'passed') passed++
			else if (test.status === 'failed') fileFailures++
			else skipped++
		}
		failed += fileFailures > 0 ? fileFailures : file.status === 'failed' ? 1 : 0
	}
	return {
		passed,
		failed,
		skipped,
		total: passed + failed + skipped,
		files: report.testResults.length,
	}
}

export function parsePlaywrightJson(text, projects = null) {
	const report = safeJson(text)
	const stats = report?.stats
	if (!stats || typeof stats.expected !== 'number') return null
	const passed = stats.expected
	const failed = stats.unexpected ?? 0
	const skipped = stats.skipped ?? 0
	const flaky = stats.flaky ?? 0
	const summary = { passed, failed, skipped, flaky, total: passed + failed + skipped + flaky }
	if (!projects) return summary
	// Playwright fails a run only when the TOTAL is zero, so a requested project that
	// selected nothing would pass unnoticed.
	const seen = new Set()
	const walk = (suite) => {
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests ?? []) seen.add(test.projectName)
		}
		for (const child of suite.suites ?? []) walk(child)
	}
	for (const suite of report.suites ?? []) walk(suite)
	return { ...summary, emptyProjects: projects.filter((name) => !seen.has(name)).length }
}

/** Biome 2: `Checked 793 files in 1978ms`. */
export function parseBiome(text) {
	const match = /Checked (\d+) file(?:\(s\)|s)? in /.exec(stripAnsi(text))
	return match ? { files: Number(match[1]), total: Number(match[1]), failed: 0 } : null
}

/** No `Files:` line means the compiler never ran. */
export function parseTscDiagnostics(text) {
	const match = /^Files:\s+(\d+)\s*$/m.exec(stripAnsi(text))
	return match ? { files: Number(match[1]), total: Number(match[1]), failed: 0 } : null
}

export function parseBundleCheck(text) {
	return /^OK: .*all positive controls hold\.\s*$/m.test(stripAnsi(text))
		? { total: 1, failed: 0 }
		: null
}

/** `tsc -b` prints nothing on success, so for it exit 0 is the only evidence. */
export function parseViteBuild(text) {
	return /✓ built in /.test(stripAnsi(text)) ? { total: 1, failed: 0 } : null
}

export function parseExitOnly(_text) {
	return { total: 1, failed: 0 }
}

/** The first real non-zero exit code, so `[killed, exit 2]` still says exit 2. */
export function aggregateParts(parts) {
	const exitCode = parts.every((p) => p.exitCode === 0)
		? 0
		: (parts.find((p) => typeof p.exitCode === 'number' && p.exitCode !== 0)?.exitCode ?? null)
	const missing = parts.filter((p) => !p.summary).length
	const summary =
		parts.length > 0 && missing === 0
			? {
					programs: parts.length,
					files: parts.reduce((sum, p) => sum + (p.summary?.files ?? 0), 0),
					total: parts.length,
					failed: 0,
				}
			: null
	return {
		exitCode,
		summary,
		signal: parts.find((p) => p.signal)?.signal ?? null,
		timedOut: parts.some((p) => p.timedOut),
		spawnError: parts.find((p) => p.spawnError)?.spawnError ?? null,
	}
}

/**
 * A skipped-only suite exits 0 having run nothing, so a test summary needs a pass. An
 * interrupted gate is never green: SIGINT can yield exit 0 with a partial report.
 */
export function verdict({
	exitCode,
	summary,
	signal = null,
	timedOut = false,
	interrupted = false,
	spawnError = null,
}) {
	const reasons = []
	if (spawnError) reasons.push(`spawn failed: ${spawnError}`)
	if (interrupted) reasons.push('interrupted')
	else if (timedOut) reasons.push('timeout')
	else if (signal) reasons.push(`killed (${signal})`)
	if (exitCode !== 0 && exitCode !== null) reasons.push(`exit ${exitCode}`)
	if (!summary) reasons.push('no summary')
	else {
		const ran = 'passed' in summary ? summary.passed > 0 : summary.total > 0
		if (!ran) reasons.push('nothing ran')
		if (summary.failed > 0) reasons.push(`${summary.failed} failed`)
		if (summary.flaky > 0) reasons.push(`${summary.flaky} flaky`)
		if (summary.emptyProjects > 0) reasons.push(`${summary.emptyProjects} project(s) ran no tests`)
	}
	if (exitCode === null && !timedOut && !signal && !interrupted && !spawnError) {
		reasons.push('no exit code')
	}
	return { green: reasons.length === 0, reasons }
}

export function formatDuration(ms) {
	const seconds = Math.round(ms / 1000)
	if (seconds < 60) return `${seconds}s`
	return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

export function formatCounts(summary) {
	if (!summary) return '-'
	if ('programs' in summary) return `${summary.programs} programs, ${summary.files} files`
	if ('passed' in summary) {
		const parts = [
			`${summary.passed} passed`,
			`${summary.failed} failed`,
			`${summary.skipped} skipped`,
		]
		if (summary.flaky) parts.push(`${summary.flaky} flaky`)
		if (summary.files) parts.push(`${summary.files} files`)
		return parts.join(', ')
	}
	if ('files' in summary) return `${summary.files} files`
	return 'ok'
}

export function formatLine(result) {
	if (result.skipped) {
		return `- ${result.id.padEnd(12)} SKIP  ${result.skipped}`
	}
	const { green, reasons } = verdict(result)
	const exit = result.exitCode === null ? '-' : String(result.exitCode)
	const line = [
		green ? '✔' : '✘',
		result.id.padEnd(12),
		green ? 'PASS' : 'FAIL',
		`exit ${exit}`.padEnd(7),
		formatDuration(result.ms).padStart(6),
		' ',
		formatCounts(result.summary),
	].join(' ')
	return green ? line : `${line}  <- ${reasons.join(', ')}`
}

export function spawnEnv(processEnv, gateEnv) {
	return { ...processEnv, ...gateEnv }
}

const E2E_FLOW_PROJECTS = ['chromium', 'chromium-paid', 'chromium-prod', 'chromium-db']

/** CI-only: baselines are CI-rendered, and a dev box's fonts differ. */
export const E2E_SCREENSHOT_PROJECTS = ['screenshots', 'screenshots-paid']

/**
 * Phase B is not read-only: e2e's prod server rebuilds apps/web/dist, so any gate that
 * reads dist must run in phase A.
 */
export function buildGates({ root, runDir, typeCheckScripts }) {
	const web = join(root, 'apps/web')
	const e2eProjects = E2E_FLOW_PROJECTS
	return [
		{
			id: 'build-pkgs',
			phase: 'A',
			cwd: root,
			command: 'pnpm',
			args: ['build:packages'],
			timeoutMs: 5 * MINUTE,
			parse: { from: 'log', fn: parseExitOnly },
		},
		{
			id: 'build-web',
			phase: 'A',
			cwd: root,
			command: 'pnpm',
			args: ['--filter', 'web', 'build'],
			timeoutMs: 5 * MINUTE,
			parse: { from: 'log', fn: parseViteBuild },
		},
		{
			id: 'bundle',
			phase: 'A',
			cwd: root,
			command: 'node',
			args: ['apps/web/scripts/check-client-bundle.mjs'],
			timeoutMs: 2 * MINUTE,
			parse: { from: 'log', fn: parseBundleCheck },
		},
		{
			id: 'types',
			phase: 'B',
			needsBuild: true,
			timeoutMs: 5 * MINUTE,
			parts: Object.entries(typeCheckScripts).flatMap(([dir, script]) =>
				typeCheckProgramsOf(dir, script).map((args) => ({
					cwd: join(root, dir),
					command: './node_modules/.bin/tsc',
					args,
				}))
			),
			parse: { from: 'log', fn: parseTscDiagnostics },
		},
		{
			id: 'biome',
			phase: 'B',
			cwd: root,
			command: 'pnpm',
			args: ['exec', 'biome', 'check', '.'],
			timeoutMs: 2 * MINUTE,
			parse: { from: 'log', fn: parseBiome },
		},
		{
			id: 'core',
			phase: 'B',
			cwd: join(root, 'packages/core'),
			command: './node_modules/.bin/vitest',
			args: vitestArgs(join(runDir, 'core.json')),
			timeoutMs: 5 * MINUTE,
			parse: { from: join(runDir, 'core.json'), fn: parseVitestJson },
		},
		{
			id: 'db',
			phase: 'B',
			cwd: join(root, 'packages/db'),
			command: './node_modules/.bin/vitest',
			args: vitestArgs(join(runDir, 'db.json')),
			timeoutMs: 5 * MINUTE,
			parse: { from: join(runDir, 'db.json'), fn: parseVitestJson },
		},
		{
			id: 'web',
			phase: 'B',
			cwd: web,
			command: './node_modules/.bin/vitest',
			args: [...vitestArgs(join(runDir, 'web.json')), '--config', 'vitest.config.ts'],
			// Vitest uses cores - 1 workers, so a small box runs near serial time; 15 min keeps a
			// slow box from reporting a timeout that reads like interference.
			timeoutMs: 15 * MINUTE,
			parse: { from: join(runDir, 'web.json'), fn: parseVitestJson },
		},
		{
			// Needs packages/*/dist: the dev servers resolve workspace packages through their
			// package.json `main`, unlike the unit suites.
			id: 'e2e',
			phase: 'B',
			needsBuild: true,
			ports: [5173, 5174, 5175, 5176, 55432],
			cwd: web,
			command: './node_modules/.bin/playwright',
			// One Playwright run: two would race for the same server ports.
			args: ['test', '--reporter=line,json', ...e2eProjects.map((name) => `--project=${name}`)],
			env: {
				PLAYWRIGHT_JSON_OUTPUT_FILE: join(runDir, 'e2e.json'),
				// An ambient PLAYWRIGHT_BASE_URL drops every webServer and the paid/prod/db projects,
				// so the gate would pass on fewer tests.
				PLAYWRIGHT_BASE_URL: '',
			},
			timeoutMs: 20 * MINUTE,
			parse: {
				from: join(runDir, 'e2e.json'),
				fn: (text) => parsePlaywrightJson(text, e2eProjects),
			},
		},
	]
}

/**
 * Phase A runs whole when any selected gate needs a build: its steps depend on each
 * other in order.
 */
export function selectGates(gates, only) {
	if (!only) return gates
	const known = new Set(gates.map((g) => g.id))
	const unknown = only.filter((id) => !known.has(id))
	if (unknown.length > 0) {
		throw new Error(`unknown gate(s): ${unknown.join(', ')}. Known: ${[...known].join(', ')}`)
	}
	const chosen = gates.filter((g) => only.includes(g.id))
	const needsPhaseA = chosen.some((g) => g.phase === 'A' || g.needsBuild)
	return gates.filter((g) => only.includes(g.id) || (needsPhaseA && g.phase === 'A'))
}

function typeCheckProgramsOf(dir, script) {
	try {
		return typeCheckPrograms(script)
	} catch (error) {
		throw new Error(`${dir}: ${error.message}`)
	}
}

export function typeCheckScriptsOf(packages) {
	return Object.fromEntries(
		packages
			.filter((pkg) => typeof pkg.scripts?.['type-check'] === 'string')
			.map((pkg) => [pkg.dir, pkg.scripts['type-check']])
	)
}

export const USAGE = `Usage: pnpm gates [--sequential] [--only <id,id,...>]

  --sequential   run phase B one gate (and one tsc program) at a time
  --only         run only these gates. types and e2e need the build, so they
                 bring phase A (build-pkgs, build-web, bundle) with them.

Gates: build-pkgs, build-web, bundle (phase A); types, biome, core, db, web, e2e (phase B)`

/** Throws on anything unknown, including a repeated `--only`. */
export function parseArgs(argv) {
	const options = { sequential: false, only: null, help: false }
	const setOnly = (value) => {
		if (options.only) throw new Error('--only given twice; list every gate in one --only')
		options.only = (value ?? '').split(',').filter(Boolean)
		if (options.only.length === 0) throw new Error('--only needs at least one gate id')
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--sequential') options.sequential = true
		else if (arg === '--only') setOnly(argv[++i])
		else if (arg.startsWith('--only=')) setOnly(arg.slice('--only='.length))
		else if (arg === '--help' || arg === '-h') options.help = true
		else throw new Error(`Unknown argument: ${arg}`)
	}
	return options
}

/**
 * Printed with the mode and again under the verdict, so a green local e2e never reads
 * as covering layout. A warning only: CI runs the screenshots regardless.
 */
export function screenshotNotice({ e2e, changedFiles = [] }) {
	if (!e2e) return []
	const lines = [
		'screenshots: CI only (baselines are CI-rendered; see e2e/pages.screenshot.spec.ts).',
	]
	const styled = changedFiles.filter((file) => /\.(tsx|css)$/.test(file))
	if (styled.length > 0) {
		lines.push(
			`⚠ ${styled.length} changed .tsx/.css file(s): layout is checked only by the CI screenshots; run \`gh workflow run screenshots.yml --ref <branch> -f mode=compare\` before merging.`
		)
	}
	return lines
}

/** Every descendant of `pid`, whatever its process group. */
export function treeOf(psTable, pid) {
	const children = new Map()
	for (const line of psTable.trim().split('\n')) {
		const [child, parent] = line.trim().split(/\s+/).map(Number)
		if (!Number.isInteger(child) || !Number.isInteger(parent)) continue
		if (!children.has(parent)) children.set(parent, [])
		children.get(parent).push(child)
	}
	const found = []
	const seen = new Set([pid])
	const queue = [pid]
	while (queue.length > 0) {
		for (const child of children.get(queue.shift()) ?? []) {
			if (seen.has(child)) continue
			seen.add(child)
			found.push(child)
			queue.push(child)
		}
	}
	return found
}

function vitestArgs(path) {
	return ['run', '--reporter=default', '--reporter=json', `--outputFile=${path}`]
}

function safeJson(text) {
	try {
		return JSON.parse(text)
	} catch {
		return null
	}
}
