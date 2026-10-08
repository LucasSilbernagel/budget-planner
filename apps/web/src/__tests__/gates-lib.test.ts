// @vitest-environment node
// Every format below is copied from a real run of that tool: a parser tested against a
// made-up format passes while the real one is never matched.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	aggregateParts,
	buildGates,
	E2E_SCREENSHOT_PROJECTS,
	formatDuration,
	formatLine,
	parseArgs,
	parseBiome,
	parseBundleCheck,
	parsePlaywrightJson,
	parseTscDiagnostics,
	parseViteBuild,
	parseVitestJson,
	screenshotNotice,
	selectGates,
	spawnEnv,
	treeOf,
	typeCheckPrograms,
	typeCheckScriptsOf,
	verdict,
} from '../../scripts/gates-lib.mjs'

describe('typeCheckPrograms', () => {
	it('turns each && part of the script into one tsc program with --diagnostics', () => {
		expect(
			typeCheckPrograms(
				'tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.vitest.json && tsc --noEmit -p tsconfig.e2e.json'
			)
		).toEqual([
			['--noEmit', '-p', 'tsconfig.app.json', '--diagnostics'],
			['--noEmit', '-p', 'tsconfig.vitest.json', '--diagnostics'],
			['--noEmit', '-p', 'tsconfig.e2e.json', '--diagnostics'],
		])
		expect(typeCheckPrograms('tsc --noEmit')).toEqual([['--noEmit', '--diagnostics']])
	})

	it('throws on a part that is not a bare tsc call, instead of skipping it', () => {
		expect(() => typeCheckPrograms('tsc --noEmit && vue-tsc --noEmit')).toThrow(/vue-tsc/)
		expect(() => typeCheckPrograms('pnpm tsc')).toThrow(/not a bare tsc call/)
		expect(() => typeCheckPrograms('')).toThrow(/missing or empty/)
	})
})

describe('parsers', () => {
	const vitestReport = (files: { status: string; tests: string[] }[]) =>
		JSON.stringify({
			// The real top-level fields of that run, which disagree with the console summary.
			numTotalTestSuites: 51,
			numTotalTests: 302,
			numPassedTests: 302,
			numFailedTests: 0,
			numPendingTests: 0,
			numTodoTests: 0,
			success: true,
			testResults: files.map((file, i) => ({
				name: `/repo/packages/db/src/f${i}.test.ts`,
				status: file.status,
				message: '',
				assertionResults: file.tests.map((status) => ({ status })),
			})),
		})

	it('vitest JSON: counts each test, not the top-level fields (which call skipped tests passed)', () => {
		const report = vitestReport([
			{ status: 'passed', tests: ['passed', 'passed', 'skipped'] },
			{ status: 'passed', tests: ['passed', 'todo', 'pending'] },
		])
		expect(parseVitestJson(report)).toEqual({
			passed: 3,
			failed: 0,
			skipped: 3,
			total: 6,
			files: 2,
		})
	})

	it('vitest JSON: failed tests, and a file that failed before collecting any test', () => {
		const report = vitestReport([
			{ status: 'failed', tests: ['passed', 'failed', 'failed'] },
			{ status: 'failed', tests: [] },
		])
		expect(parseVitestJson(report)).toMatchObject({ passed: 1, failed: 3, total: 4, files: 2 })
	})

	it('vitest JSON: missing, empty or unparsable is NO summary (not zero tests)', () => {
		expect(parseVitestJson('')).toBeNull()
		expect(parseVitestJson('{"truncated":')).toBeNull()
		expect(parseVitestJson('{}')).toBeNull()
	})

	it('vitest JSON: zero files collected parses to total 0, which the verdict calls RED', () => {
		const summary = parseVitestJson(vitestReport([]))
		expect(summary).toMatchObject({ total: 0, files: 0 })
		expect(verdict({ exitCode: 0, summary }).reasons).toEqual(['nothing ran'])
	})

	it('playwright JSON: the real stats of the 82.1 close run', () => {
		const real = {
			startTime: '2026-09-30T15:51:43.718Z',
			duration: 414800.65499999997,
			expected: 520,
			skipped: 4,
			unexpected: 0,
			flaky: 0,
		}
		expect(parsePlaywrightJson(JSON.stringify({ suites: [], errors: [], stats: real }))).toEqual({
			passed: 520,
			failed: 0,
			skipped: 4,
			flaky: 0,
			total: 524,
		})
	})

	// Playwright errors only when the TOTAL is zero, so a requested project that selects nothing
	// must fail the gate here.
	const report = (projects: string[]) =>
		JSON.stringify({
			suites: [
				{
					title: 'a.spec.ts',
					specs: [],
					suites: [
						{
							title: 'describe',
							specs: [{ tests: projects.map((projectName) => ({ projectName })) }],
						},
					],
				},
			],
			errors: [],
			stats: { expected: projects.length, skipped: 0, unexpected: 0, flaky: 0 },
		})

	it('playwright JSON: a requested project with no tests is counted (story 82.3 P1)', () => {
		expect(parsePlaywrightJson(report(['chromium']), ['chromium', 'chromium-paid'])).toMatchObject({
			passed: 1,
			emptyProjects: 1,
		})
		expect(
			parsePlaywrightJson(report(['chromium', 'chromium-paid']), ['chromium', 'chromium-paid'])
		).toMatchObject({ emptyProjects: 0 })
		expect(parsePlaywrightJson(report(['chromium']))).not.toHaveProperty('emptyProjects')
	})

	it('an empty requested project makes the gate RED', () => {
		expect(
			verdict({
				exitCode: 0,
				summary: { passed: 5, failed: 0, skipped: 0, flaky: 0, total: 5, emptyProjects: 1 },
			})
		).toEqual({ green: false, reasons: ['1 project(s) ran no tests'] })
	})

	it('the e2e gate parses with the projects it asked for', () => {
		const e2e = buildGates({ root: '/r', runDir: '/d', typeCheckScripts: {} }).find(
			(g) => g.id === 'e2e'
		)
		expect(e2e?.parse.fn(report(['chromium', 'chromium-paid', 'chromium-prod']))).toMatchObject({
			emptyProjects: 1,
		})
	})

	it('playwright JSON: unexpected is failed, flaky is kept (values edited, real shape)', () => {
		const report = JSON.stringify({
			config: {},
			suites: [],
			errors: [],
			stats: {
				startTime: '2026-09-30T00:00:00.000Z',
				duration: 1,
				expected: 520,
				skipped: 4,
				unexpected: 1,
				flaky: 2,
			},
		})
		expect(parsePlaywrightJson(report)).toEqual({
			passed: 520,
			failed: 1,
			skipped: 4,
			flaky: 2,
			total: 527,
		})
		expect(parsePlaywrightJson('{"suites":[]}')).toBeNull()
	})

	it('biome: the Checked line', () => {
		expect(parseBiome('\n\nChecked 683 file(s) in 502ms\n')).toMatchObject({ files: 683 })
		expect(parseBiome('Checked 1 file in 3ms')).toMatchObject({ files: 1 })
		expect(parseBiome('internalError/io  No such file')).toBeNull()
	})

	it('tsc --diagnostics: the Files line, and nothing at all is NO summary', () => {
		expect(
			parseTscDiagnostics(
				'Files:             168\nLines:          104596\nIdentifiers:     89023\n'
			)
		).toMatchObject({ files: 168 })
		expect(parseTscDiagnostics('')).toBeNull()
		expect(
			parseTscDiagnostics(
				'ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT  None of the selected packages has a "tsc" script'
			)
		).toBeNull()
	})

	it('bundle check: only its OK line counts', () => {
		expect(
			parseBundleCheck(
				'OK: no server-only marker (DATABASE_URL, SESSION_SECRET, SCRAM-SHA-256, client_encoding) in /x/apps/web/dist/client; all positive controls hold.\n'
			)
		).not.toBeNull()
		expect(parseBundleCheck('Client-bundle guard FAILED for /x/dist:\n  - ...')).toBeNull()
	})

	it('colour codes (an ambient FORCE_COLOR) do not hide a summary', () => {
		expect(parseBiome('Checked \u001b[1m683\u001b[22m file(s) in 502ms')).toMatchObject({
			files: 683,
		})
		expect(parseTscDiagnostics('\u001b[36mFiles:\u001b[39m             168\n')).toMatchObject({
			files: 168,
		})
	})

	it('vite build: the built line', () => {
		expect(parseViteBuild('✓ 1006 modules transformed.\n✓ built in 6.51s\n')).not.toBeNull()
		expect(parseViteBuild('error during build:')).toBeNull()
	})
})

describe('verdict', () => {
	const passing = { passed: 10, failed: 0, skipped: 0, total: 10 }

	it('green only with exit 0, a summary, something counted and nothing failed', () => {
		expect(verdict({ exitCode: 0, summary: passing })).toEqual({ green: true, reasons: [] })
	})

	it('exit 0 with no summary is RED: the gate that died before running anything', () => {
		expect(verdict({ exitCode: 0, summary: null })).toEqual({
			green: false,
			reasons: ['no summary'],
		})
	})

	it('exit 0 with nothing collected is RED: the `(0 test)` runner mismatch', () => {
		expect(verdict({ exitCode: 0, summary: { passed: 0, failed: 0, total: 0 } })).toEqual({
			green: false,
			reasons: ['nothing ran'],
		})
	})

	it('failures in the summary are RED even when the exit code says 0', () => {
		expect(verdict({ exitCode: 0, summary: { ...passing, failed: 2 } }).reasons).toEqual([
			'2 failed',
		])
	})

	it('exit 1 with an all-passing summary is RED: an unhandled error after the tests', () => {
		expect(verdict({ exitCode: 1, summary: passing })).toEqual({
			green: false,
			reasons: ['exit 1'],
		})
	})

	it('a flaky count is RED: local retries are 0, so it can only mean someone hid a failure', () => {
		expect(verdict({ exitCode: 0, summary: { ...passing, flaky: 1 } }).reasons).toEqual(['1 flaky'])
	})

	it('every test skipped is RED: exit 0 and a summary, but nothing actually ran', () => {
		expect(
			verdict({ exitCode: 0, summary: { passed: 0, failed: 0, skipped: 302, total: 302 } }).reasons
		).toEqual(['nothing ran'])
		expect(verdict({ exitCode: 0, summary: { files: 683, total: 683, failed: 0 } }).green).toBe(
			true
		)
	})

	it('an interrupted gate is RED even when it exited 0 with a passing partial report', () => {
		expect(verdict({ exitCode: 0, summary: passing, interrupted: true })).toEqual({
			green: false,
			reasons: ['interrupted'],
		})
		expect(verdict({ exitCode: 130, summary: null, interrupted: true }).reasons).toEqual([
			'interrupted',
			'exit 130',
			'no summary',
		])
	})

	it('a spawn failure is named, not reduced to "no exit code"', () => {
		expect(
			verdict({ exitCode: null, summary: null, spawnError: 'spawn ./node_modules/.bin/tsc ENOENT' })
				.reasons
		).toEqual(['spawn failed: spawn ./node_modules/.bin/tsc ENOENT', 'no summary'])
	})

	it('timeout and kill are named', () => {
		expect(
			verdict({ exitCode: null, summary: null, timedOut: true, signal: 'SIGTERM' }).reasons
		).toEqual(['timeout', 'no summary'])
		expect(verdict({ exitCode: null, summary: null, signal: 'SIGINT' }).reasons).toEqual([
			'killed (SIGINT)',
			'no summary',
		])
	})
})

describe('aggregateParts (the type-check programs)', () => {
	const ok = { exitCode: 0, summary: { files: 100, total: 100, failed: 0 } }

	it('sums the programs when every one ran', () => {
		expect(aggregateParts([ok, ok, ok])).toMatchObject({
			exitCode: 0,
			summary: { programs: 3, files: 300 },
		})
		expect(verdict(aggregateParts([ok, ok])).green).toBe(true)
	})

	it('one silent program makes the whole gate NO summary', () => {
		const result = aggregateParts([ok, { exitCode: 0, summary: null }])
		expect(result.summary).toBeNull()
		expect(verdict(result).reasons).toEqual(['no summary'])
	})

	it('one failing program fails the gate with its exit code', () => {
		expect(
			aggregateParts([ok, { exitCode: 2, summary: { files: 1, total: 1, failed: 0 } }]).exitCode
		).toBe(2)
	})

	it('a killed part before a failing one does not hide the real exit code', () => {
		const result = aggregateParts([
			{ exitCode: null, summary: null, signal: 'SIGKILL' },
			{ exitCode: 2, summary: { files: 1, total: 1, failed: 0 } },
		])
		expect(result.exitCode).toBe(2)
		expect(verdict(result).reasons).toContain('exit 2')
	})

	it('a part that failed to spawn carries its error to the gate', () => {
		expect(
			aggregateParts([ok, { exitCode: null, summary: null, spawnError: 'ENOENT' }]).spawnError
		).toBe('ENOENT')
	})

	it('no programs at all is NO summary', () => {
		expect(aggregateParts([]).summary).toBeNull()
	})
})

describe('formatting', () => {
	it('durations', () => {
		expect(formatDuration(4_400)).toBe('4s')
		expect(formatDuration(315_000)).toBe('5m15s')
	})

	it('one line per gate, with the reasons on a red one', () => {
		expect(
			formatLine({
				id: 'web',
				exitCode: 0,
				ms: 312_000,
				summary: { passed: 4009, failed: 0, skipped: 3, total: 4012, files: 258 },
			})
		).toMatch(/^✔ web +PASS exit 0 +5m12s +4009 passed, 0 failed, 3 skipped, 258 files$/)
		const red = formatLine({ id: 'types', exitCode: 0, ms: 1000, summary: null })
		expect(red).toMatch(/^✘ types +FAIL/)
		expect(red).toMatch(/<- no summary$/)
		expect(
			formatLine({ id: 'e2e', exitCode: null, ms: 0, summary: null, skipped: 'phase A failed' })
		).toMatch(/^- e2e +SKIP +phase A failed$/)
	})
})

describe('buildGates', () => {
	const gates = buildGates({
		root: '/repo',
		runDir: '/run',
		typeCheckScripts: {
			'apps/web': 'tsc --noEmit -p a.json && tsc --noEmit -p b.json',
			'packages/core': 'tsc --noEmit',
		},
	})
	const byId = Object.fromEntries(gates.map((g) => [g.id, g]))

	it('phase A builds, then checks the bundle, before anything runs concurrently', () => {
		expect(gates.filter((g) => g.phase === 'A').map((g) => g.id)).toEqual([
			'build-pkgs',
			'build-web',
			'bundle',
		])
		expect(gates.filter((g) => g.phase === 'B').map((g) => g.id)).toEqual([
			'types',
			'biome',
			'core',
			'db',
			'web',
			'e2e',
		])
	})

	it('the web suite runs its files in parallel, with no localStorage file (story 82.2)', () => {
		expect(byId['web']?.args).not.toContain('--no-file-parallelism')
		expect(byId['web']?.args?.some((a) => a.includes('localstorage'))).toBe(false)
		expect(byId['web']?.env).toBeUndefined()
		expect(byId['web']?.timeoutMs).toBe(15 * 60_000)
	})

	it('every vitest gate uses its package-local binary (the root one is another major)', () => {
		for (const id of ['core', 'db', 'web']) {
			expect(byId[id]?.command).toBe('./node_modules/.bin/vitest')
		}
	})

	it('types runs one part per program, in each package, with the local tsc', () => {
		expect(byId['types']?.parts).toEqual([
			{
				cwd: '/repo/apps/web',
				command: './node_modules/.bin/tsc',
				args: ['--noEmit', '-p', 'a.json', '--diagnostics'],
			},
			{
				cwd: '/repo/apps/web',
				command: './node_modules/.bin/tsc',
				args: ['--noEmit', '-p', 'b.json', '--diagnostics'],
			},
			{
				cwd: '/repo/packages/core',
				command: './node_modules/.bin/tsc',
				args: ['--noEmit', '--diagnostics'],
			},
		])
	})

	it('an ambient NODE_OPTIONS reaches every gate unchanged', () => {
		const ambient = { NODE_OPTIONS: '--max-old-space-size=8192', PATH: '/bin' }
		for (const gate of gates) {
			expect(spawnEnv(ambient, gate.env)['NODE_OPTIONS']).toBe('--max-old-space-size=8192')
		}
	})

	it('spawnEnv lets a gate override one variable and keeps the rest', () => {
		expect(spawnEnv({ A: '1', B: '2' }, { B: '3' })).toEqual({ A: '1', B: '3' })
		expect(spawnEnv({ A: '1' }, undefined)).toEqual({ A: '1' })
	})

	it('e2e claims every Playwright server port so the runner can refuse a stray server', () => {
		expect(byId['e2e']?.ports).toEqual([5173, 5174, 5175, 5176, 55432])
	})

	it('the e2e ports match the db harness constants (story 87.1), so they cannot drift', () => {
		// Read as text: `e2e/` is outside this test program (TS6307 on an import).
		const harness = readFileSync(join(__dirname, '../../e2e/helpers/db-harness.ts'), 'utf8')
		const constant = (name: string) =>
			Number(harness.match(new RegExp(`export const ${name} = (\\d+)$`, 'm'))?.[1])
		expect(constant('DB_SERVER_PORT')).toBe(5176)
		expect(constant('E2E_DB_PORT')).toBe(55432)
		for (const name of ['DB_SERVER_PORT', 'E2E_DB_PORT']) {
			expect(byId['e2e']?.ports).toContain(constant(name))
		}
	})

	it('e2e blanks an ambient PLAYWRIGHT_BASE_URL (it would drop every webServer)', () => {
		expect(byId['e2e']?.env?.['PLAYWRIGHT_BASE_URL']).toBe('')
	})

	// Selection is by project NAME, so a renamed project must fail here, not drop out of the gate.
	const projectsOf = (gate: (typeof gates)[number] | undefined) =>
		(gate?.args ?? []).filter((a) => a.startsWith('--project=')).map((a) => a.slice(10))

	it('e2e runs the flow projects (story 82.3; the layout ones are gone since 84.2)', () => {
		expect(projectsOf(byId['e2e'])).toEqual([
			'chromium',
			'chromium-paid',
			'chromium-prod',
			'chromium-db',
		])
	})

	it('CI runs every Playwright project, so the screenshots always block a merge and a deploy', () => {
		const ci = readFileSync(join(__dirname, '../../../../.github/workflows/ci.yml'), 'utf8')
		const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'))
		expect(ci).toMatch(/^\s*run: pnpm test:e2e$/m)
		expect(pkg.scripts['test:e2e']).toBe('playwright test')
	})

	// Baselines are rendered by screenshots.yml and compared by ci.yml, so both need the SAME image.
	it('ci.yml e2e-tests and screenshots.yml run on the same pinned runner image (story 84.1)', () => {
		const workflows = join(__dirname, '../../../../.github/workflows')
		const runsOn = (file: string, job: string) => {
			const text = readFileSync(join(workflows, file), 'utf8')
			const block = text.slice(text.indexOf(`\n  ${job}:\n`))
			return block.match(/^ {4}runs-on: (\S+)$/m)?.[1]
		}
		const ci = runsOn('ci.yml', 'e2e-tests')
		expect(ci).toMatch(/^ubuntu-\d{2}\.\d{2}$/)
		expect(runsOn('screenshots.yml', 'screenshots')).toBe(ci)
	})

	it('CI never sets PLAYWRIGHT_BASE_URL (it drops the paid and prod projects)', () => {
		const ci = readFileSync(join(__dirname, '../../../../.github/workflows/ci.yml'), 'utf8')
		expect(ci).not.toMatch(/PLAYWRIGHT_BASE_URL/)
	})

	it('no e2e spec carries a Playwright tag (story 84.2, D5)', () => {
		const dir = join(__dirname, '../../e2e')
		// Recursive, every extension Playwright's testMatch picks up; files only (baseline
		// directories are named after their specs).
		const specs = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(
			(f) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(f) && statSync(join(dir, f)).isFile()
		)
		expect(specs.length).toBeGreaterThanOrEqual(10)
		expect(specs.some((file) => /(^|\/)smoke\.spec\.ts$/.test(file))).toBe(true)
		// A string/array literal or a CONSTANT_CASE identifier (`tag: LAYOUT`), not
		// any value: `page.evaluate` results carry `tag: el?.tagName` keys.
		const tagged = specs.filter((file) =>
			/\btag:\s*(['"`[]|[A-Z_][A-Z0-9_]*\b)/.test(readFileSync(join(dir, file), 'utf8'))
		)
		expect(tagged, 'spec(s) still carry a Playwright tag').toEqual([])
	})

	// Screenshot projects run only in CI (baselines depend on its fonts), so every project is
	// either in the local run or a screenshot project, never both.
	it('the local e2e run names every Playwright project except the CI-only screenshot ones', () => {
		const config = readFileSync(join(__dirname, '../../playwright.config.ts'), 'utf8')
		const declared = [...config.matchAll(/^\s*name: '([^']+)',$/gm)].map((m) => m[1]).sort()
		expect(declared).toHaveLength(6)
		// A re-added `grep:` plus an `@word` in a title would silently split the suite.
		expect(config).not.toMatch(/\bgrep(Invert)?:/)
		expect(E2E_SCREENSHOT_PROJECTS).toEqual(['screenshots', 'screenshots-paid'])
		expect([...projectsOf(byId['e2e']), ...E2E_SCREENSHOT_PROJECTS].sort()).toEqual(declared)
	})

	it('no local e2e run includes a screenshot project (story 84.1)', () => {
		// Non-empty first: an e2e gate with NO --project flag runs EVERY project,
		// screenshot ones included, and would pass the not.toContain below.
		expect(projectsOf(byId['e2e']).length).toBeGreaterThan(0)
		for (const name of E2E_SCREENSHOT_PROJECTS) expect(projectsOf(byId['e2e'])).not.toContain(name)
	})

	it('a bad type-check script names its package', () => {
		expect(() =>
			buildGates({ root: '/r', runDir: '/d', typeCheckScripts: { 'packages/x': 'vue-tsc' } })
		).toThrow(/^packages\/x: type-check part is not a bare tsc call/)
	})
})

describe('selectGates (--only)', () => {
	const gates = buildGates({ root: '/r', runDir: '/d', typeCheckScripts: { x: 'tsc' } })
	const ids = (only: string[] | null) => selectGates(gates, only).map((g) => g.id)

	it('a gate that needs no build runs alone', () => {
		expect(ids(['core'])).toEqual(['core'])
		expect(ids(['web', 'biome'])).toEqual(['biome', 'web'])
	})

	it('a gate that needs the build brings the whole of phase A', () => {
		expect(ids(['types'])).toEqual(['build-pkgs', 'build-web', 'bundle', 'types'])
		expect(ids(['e2e'])).toEqual(['build-pkgs', 'build-web', 'bundle', 'e2e'])
	})

	it('an unknown gate id throws with the known ids', () => {
		expect(() => ids(['wbe'])).toThrow(/unknown gate\(s\): wbe\. Known: build-pkgs/)
	})

	it('no --only runs everything', () => {
		expect(ids(null)).toHaveLength(gates.length)
	})
})

describe('typeCheckScriptsOf', () => {
	it('takes every package that HAS a type-check script, and only those', () => {
		expect(
			typeCheckScriptsOf([
				{ dir: 'apps/web', scripts: { 'type-check': 'tsc -p a' } },
				{ dir: 'packages/core', scripts: { build: 'tsc' } },
				{ dir: 'packages/new', scripts: { 'type-check': 'tsc --noEmit' } },
				{ dir: 'packages/bare' },
			])
		).toEqual({ 'apps/web': 'tsc -p a', 'packages/new': 'tsc --noEmit' })
	})
})

describe('parseArgs', () => {
	it('flags', () => {
		expect(parseArgs([])).toEqual({ sequential: false, only: null, help: false })
		expect(parseArgs(['--sequential', '--only', 'core,web'])).toEqual({
			sequential: true,
			only: ['core', 'web'],
			help: false,
		})
		expect(parseArgs(['--only=e2e']).only).toEqual(['e2e'])
		expect(parseArgs(['-h']).help).toBe(true)
	})

	it('a second --only is an error, not a silent replacement', () => {
		expect(() => parseArgs(['--only', 'core', '--only', 'web'])).toThrow(/--only given twice/)
	})

	it('--layout is gone (story 84.2): it is an unknown argument, not a silent no-op', () => {
		expect(() => parseArgs(['--layout'])).toThrow(/Unknown argument: --layout/)
	})

	it('an empty --only and an unknown flag are errors', () => {
		expect(() => parseArgs(['--only'])).toThrow(/at least one gate id/)
		expect(() => parseArgs(['--only='])).toThrow(/at least one gate id/)
		expect(() => parseArgs(['--frobnicate'])).toThrow(/Unknown argument: --frobnicate/)
	})
})

describe('treeOf (the process tree a stop must reach)', () => {
	// `ps -A -o pid=,ppid=` shape. 10 is the gate; 11 Playwright; 12 and 13 its
	// webServers (own process groups, same ancestry); 14 a server's child.
	const ps = `
      1     0
     10     1
     11    10
     12    11
     13    11
     14    12
     99     1
  `

	it('finds every descendant, whatever its process group, and nothing else', () => {
		expect(treeOf(ps, 10).sort((a, b) => a - b)).toEqual([11, 12, 13, 14])
		expect(treeOf(ps, 14)).toEqual([])
	})

	it('ignores junk lines and survives a cycle', () => {
		expect(treeOf('garbage\n  5 4\n  4 5\n', 4)).toEqual([5])
	})
})

describe('screenshotNotice (story 84.1, D3; 84.2, D4)', () => {
	const CI_ONLY =
		'screenshots: CI only (baselines are CI-rendered; see e2e/pages.screenshot.spec.ts).'

	it('says the screenshot projects are CI only whenever e2e runs', () => {
		expect(screenshotNotice({ e2e: true, changedFiles: ['README.md'] })).toEqual([CI_ONLY])
	})

	it('treats omitted changedFiles as no changes (84.2 review)', () => {
		expect(screenshotNotice({ e2e: true })).toEqual([CI_ONLY])
	})

	it('warns when the tree changes a .tsx/.css file, since only CI checks layout now', () => {
		expect(
			screenshotNotice({
				e2e: true,
				changedFiles: [
					'apps/web/src/components/HomePage.tsx',
					'apps/web/src/styles/app.css',
					'x.ts',
				],
			})
		).toEqual([
			CI_ONLY,
			'⚠ 2 changed .tsx/.css file(s): layout is checked only by the CI screenshots; run `gh workflow run screenshots.yml --ref <branch> -f mode=compare` before merging.',
		])
	})

	it('says nothing when e2e was not selected', () => {
		expect(screenshotNotice({ e2e: false, changedFiles: ['a.tsx'] })).toEqual([])
	})
})
