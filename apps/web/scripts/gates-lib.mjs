// The gate runner's logic (story 82.1, FR133). The CLI is `run-gates.mjs`; this
// file holds everything that can be decided without spawning a process, so the
// web unit suite can pin it (`src/__tests__/gates-lib.test.ts`).
//
// ## The rule that matters most
//
// A gate is GREEN only when it exited 0 AND its own summary was found AND that
// summary counted at least one thing AND nothing failed. "Exit 0" alone is not
// enough: this repo has had a type-check script that exited without compiling
// anything (the dead `tsc:*` scripts), a web suite that collected `(0 test)`
// under the wrong vitest binary, and a gate piped through `tail` that reported
// tail's status. Each of those looked green by exit code. A harness that can
// fail before it runs anything must prove that it ran.

import { join } from 'node:path'

const MINUTE = 60_000

/** ANSI colour codes, stripped before any text parsing (an ambient FORCE_COLOR adds them). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/** @param {string} text */
export function stripAnsi(text) {
  return text.replace(ANSI, '')
}

/**
 * The type-check programs of one package, from its `type-check` script.
 *
 * The script is the single source of truth: `pnpm --filter web type-check` and
 * the runner must check the same programs, so the runner derives them rather
 * than keeping its own copy. Each `&&` part must be a bare `tsc` call; anything
 * else throws, so a changed script fails loudly instead of being skipped.
 *
 * `--diagnostics` is appended because `tsc --noEmit` prints NOTHING on success,
 * which leaves no summary to check. With it, tsc prints a `Files:` line.
 *
 * @param {string} script
 * @returns {string[][]} one argv (without the `tsc` binary) per program
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
 * Vitest's JSON report, counted from the per-test `assertionResults`.
 *
 * ⚠️ NOT from the top-level `num*` fields. MEASURED on the db suite (vitest
 * 1.6.1, story 82.1): the console said `295 passed | 7 skipped` across 12 files,
 * while the JSON's top level said `numPassedTests: 302, numPendingTests: 0` and
 * `numTotalTestSuites: 51` (describe blocks, not files). The per-test statuses
 * (295 passed, 7 skipped) and `testResults.length` (12) match the console.
 *
 * A file that fails before collecting any test (an import error) has
 * `status: 'failed'` and no assertions, so it is counted as a failure too.
 *
 * @param {string} text
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

/**
 * Playwright's JSON report. `expected` = passed, `unexpected` = failed.
 * @param {string} text
 */
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
  // Story 82.3 review P1: Playwright fails a run only when the TOTAL is zero, so
  // a requested project that selected nothing would pass unnoticed.
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

/**
 * Biome 1.5.3: `Checked 683 file(s) in 502ms` (literally `file(s)`).
 * @param {string} text
 */
export function parseBiome(text) {
  const match = /Checked (\d+) file(?:\(s\)|s)? in /.exec(stripAnsi(text))
  return match ? { files: Number(match[1]), total: Number(match[1]), failed: 0 } : null
}

/**
 * `tsc --diagnostics`: a `Files:  1234` line. Absent → the compiler never ran.
 * @param {string} text
 */
export function parseTscDiagnostics(text) {
  const match = /^Files:\s+(\d+)\s*$/m.exec(stripAnsi(text))
  return match ? { files: Number(match[1]), total: Number(match[1]), failed: 0 } : null
}

/**
 * `check-client-bundle.mjs` prints this line only when every marker is absent
 * from `dist/client` AND every positive control held.
 * @param {string} text
 */
export function parseBundleCheck(text) {
  return /^OK: .*all positive controls hold\.\s*$/m.test(stripAnsi(text))
    ? { total: 1, failed: 0 }
    : null
}

/**
 * A build step has no count to report; its summary is its own success line.
 * `tsc -b` prints nothing on success, so for it exit 0 is the only evidence
 * there is, and the types gate that follows is what proves the output is usable.
 * @param {string} text
 */
export function parseViteBuild(text) {
  return /✓ built in /.test(stripAnsi(text)) ? { total: 1, failed: 0 } : null
}

/** @param {string} _text */
export function parseExitOnly(_text) {
  return { total: 1, failed: 0 }
}

/**
 * Several programs that make up one gate (the type-check programs).
 *
 * The exit code is the first REAL non-zero code; `null` (killed, never
 * started) only when no part has one, so `[killed, exit 2]` still says exit 2.
 *
 * @param {{exitCode: number|null, summary: {files:number}|null, signal?: string|null, timedOut?: boolean, spawnError?: string}[]} parts
 */
export function aggregateParts(parts) {
  const exitCode = parts.every((p) => p.exitCode === 0)
    ? 0
    : parts.find((p) => typeof p.exitCode === 'number' && p.exitCode !== 0)?.exitCode ?? null
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
 * GREEN iff exit 0 AND a summary AND something ran AND failed = 0 AND flaky = 0
 * AND the run was not interrupted. Every reason that applies is listed, so
 * "exit 1, no summary" is told apart from "exit 0, no summary" (the second is
 * the dangerous one).
 *
 * "Something ran" means at least one test PASSED for a test summary (one with
 * `passed`): a suite whose every test was skipped exits 0 and ran nothing. For
 * a count-only summary (files checked, programs) it means total > 0.
 *
 * An interrupted gate is never green: vitest and Playwright turn SIGINT into
 * exit 130 or even exit 0 with a partial report, so neither the exit code nor
 * the summary can be trusted after one.
 *
 * @param {{exitCode: number|null, summary: Record<string, number>|null, signal?: string|null, timedOut?: boolean, interrupted?: boolean, spawnError?: string|null}} result
 * @returns {{green: boolean, reasons: string[]}}
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

/** @param {number} ms */
export function formatDuration(ms) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

/** @param {Record<string, number>|null} summary */
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

/**
 * One line per gate: mark, id, verdict, exit code, counts, wall time, reasons.
 * @param {{id: string, exitCode: number|null, summary: Record<string, number>|null, ms: number, skipped?: string, signal?: string|null, timedOut?: boolean, interrupted?: boolean, spawnError?: string|null}} result
 */
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

/**
 * The environment a gate is spawned with: the runner's own, plus the gate's
 * overrides. So an ambient variable (e.g. NODE_OPTIONS) reaches every gate that
 * does not set it.
 *
 * @param {Record<string, string | undefined>} processEnv
 * @param {Record<string, string> | undefined} gateEnv
 */
export function spawnEnv(processEnv, gateEnv) {
  return { ...processEnv, ...gateEnv }
}

/**
 * The Playwright projects `pnpm gates` runs. Story 84.2 (FR137) deleted the
 * `@layout` projects and `--layout`: layout is pinned by the screenshot
 * projects below, in CI only.
 */
const E2E_FLOW_PROJECTS = ['chromium', 'chromium-paid', 'chromium-prod', 'chromium-db']

/**
 * The screenshot projects (story 84.1, FR137, D3). Declared in
 * `playwright.config.ts` and run by CI's plain `playwright test`, but in NO local
 * gate run: their baselines are rendered in CI (`.github/workflows/screenshots.yml`),
 * and CI resolves `system-ui` to DejaVu Sans where a dev box gets Noto Sans, so a
 * local comparison would fail on fonts, not on the change.
 */
export const E2E_SCREENSHOT_PROJECTS = ['screenshots', 'screenshots-paid']

/**
 * The gate table. Phase A runs one step at a time and WRITES the tree
 * (`packages/*\/dist`, `apps/web/dist`, `src/routeTree.gen.ts`); phase B runs
 * concurrently.
 *
 * ⚠️ Phase B is NOT read-only. e2e's `chromium-prod` server runs `pnpm build` on
 * every run, which EMPTIES and rewrites `apps/web/dist` and re-runs the route
 * generator. That is safe only because no other phase B gate reads either:
 * `dist` is excluded from every tsconfig, from biome and from vitest, and the
 * generator rewrites `routeTree.gen.ts` only when its content changes, via a
 * temp file + rename (MEASURED unchanged across a full e2e run, story 82.1). The
 * bundle check DOES read `dist`, so it runs in phase A, before e2e starts.
 * A new phase B gate that reads `apps/web/dist` must go to phase A as well.
 * ⚠️ Since story 84.4 the `web` gate is a phase B WRITER too: its served-app
 * harness (`src/test/served-app.ts`) boots two in-process Vite dev servers
 * (one per `*.served.test.ts` file) alongside e2e's two `pnpm dev` servers, so
 * four route generators and four vite-plugin-pwa dev instances may touch
 * `src/routeTree.gen.ts`, `.tanstack/` and `dev-dist/` at once. The harness
 * keeps its OWN dep cache (`node_modules/.vite-served-app`; sharing
 * `node_modules/.vite` made the e2e servers re-optimize mid-test, MEASURED at
 * 84.4). Nothing in phase B asserts on `dev-dist/`, so a half-written dev
 * `sw.js` is noise today; a dev e2e that asserts the SW would need to know.
 *
 * Every command is the `project-context.md` › Testing Strategy command, with
 * machine-readable reporters added (they change what is printed, not what runs).
 * No gate sets NODE_OPTIONS, so an ambient one reaches every gate unchanged.
 *
 * @param {{root: string, runDir: string, typeCheckScripts: Record<string, string>}} options
 *   `typeCheckScripts` maps a package dir (relative to root) to its `type-check` script.
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
      // Files run in parallel and need no `--localstorage-file` (story 82.2):
      // `src/test/webstorage.ts` gives each file its own jsdom storage.
      id: 'web',
      phase: 'B',
      cwd: web,
      command: './node_modules/.bin/vitest',
      args: [...vitestArgs(join(runDir, 'web.json')), '--config', 'vitest.config.ts'],
      // MEASURED on an 8-core box (story 82.2): ~110 s alone in parallel, 179 s
      // in phase B, 454 s serial. Vitest uses cores - 1 workers, so a small box
      // runs near the serial time plus contention: 15 min keeps a slow box from
      // reporting a timeout that reads like interference.
      timeoutMs: 15 * MINUTE,
      parse: { from: join(runDir, 'web.json'), fn: parseVitestJson },
    },
    {
      // Needs `packages/*/dist`: the dev servers resolve workspace packages
      // through their package.json `main`, unlike the unit suites (aliased to src).
      id: 'e2e',
      phase: 'B',
      needsBuild: true,
      // :5176 is `chromium-db`'s dev server and :55432 its PGlite socket
      // (story 87.1; the values are `e2e/helpers/db-harness.ts`'s, pinned
      // equal by gates-lib.test.ts).
      ports: [5173, 5174, 5175, 5176, 55432],
      cwd: web,
      command: './node_modules/.bin/playwright',
      // ONE Playwright run: two runs would race for the same server ports.
      // The screenshot projects are never named here (E2E_SCREENSHOT_PROJECTS).
      args: ['test', '--reporter=line,json', ...e2eProjects.map((name) => `--project=${name}`)],
      env: {
        PLAYWRIGHT_JSON_OUTPUT_FILE: join(runDir, 'e2e.json'),
        // An ambient PLAYWRIGHT_BASE_URL drops every webServer and the
        // paid/prod/db projects (playwright.config.ts), so the gate would pass on
        // fewer tests against some other server. The config tests truthiness.
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
 * Which gates to run for `--only`. Phase A runs whole when any selected gate
 * needs a build (or is itself a phase A step), because its steps depend on each
 * other in order.
 *
 * @param {ReturnType<typeof buildGates>} gates
 * @param {string[]|null} only
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

/** `typeCheckPrograms`, with the package named in any error. */
function typeCheckProgramsOf(dir, script) {
  try {
    return typeCheckPrograms(script)
  } catch (error) {
    throw new Error(`${dir}: ${error.message}`)
  }
}

/**
 * The packages to type-check: every workspace package that HAS a `type-check`
 * script, so a new package cannot be silently left out.
 *
 * @param {{dir: string, scripts?: Record<string, string>}[]} packages
 * @returns {Record<string, string>} dir → type-check script
 */
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

/**
 * The CLI flags. Throws on anything it does not understand, including a
 * repeated `--only` (the second would otherwise silently replace the first).
 *
 * @param {string[]} argv
 * @returns {{sequential: boolean, only: string[]|null, help: boolean}}
 */
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
 * The lines that say the screenshot projects did not run here (story 84.1, D3),
 * printed with the mode and again under the final verdict, so a GREEN local e2e
 * never reads as covering layout. `changedFiles` are the working tree's changes
 * (tracked + untracked): since story 84.2 deleted the `@layout` tests, a
 * `.tsx`/`.css` change is checked for page layout mainly by the CI screenshots
 * (the only layout-dedicated projects left), so the runner says how to run them
 * before merging (84.2 D4, keeping 82.3 review P4's intent). A warning, not a
 * failure: CI runs the screenshots on every PR to main and every deploy
 * regardless.
 *
 * @param {{e2e: boolean, changedFiles?: string[]}} options
 * @returns {string[]}
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

/**
 * Every process descended from `pid`, from a `ps -A -o pid=,ppid=` table,
 * whatever its process group.
 *
 * @param {string} psTable
 * @param {number} pid
 * @returns {number[]}
 */
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

/** @param {string} path */
function vitestArgs(path) {
  return ['run', '--reporter=default', '--reporter=json', `--outputFile=${path}`]
}

/** @param {string} text */
function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
