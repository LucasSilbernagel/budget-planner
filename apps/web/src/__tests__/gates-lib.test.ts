// @vitest-environment node
/**
 * The gate runner's logic (story 82.1, FR133).
 *
 * The rule under test: a gate is green only when it exited 0 AND printed its own
 * summary AND that summary counted something AND nothing failed. Every FORMAT
 * below is taken from a REAL run of that tool in this repo (story 82.1 Debug
 * Log), because a parser tested against a made-up format passes while the real
 * one is never matched. Where a case needs a failure the real runs did not have
 * (a failed or flaky count), the values are edited in the real shape, and say so.
 */

import { describe, expect, it } from 'vitest'
import {
  aggregateParts,
  buildGates,
  formatDuration,
  formatLine,
  parseArgs,
  parseBiome,
  parseBundleCheck,
  parsePlaywrightJson,
  parseTscDiagnostics,
  parseViteBuild,
  parseVitestJson,
  selectGates,
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
  /** The shape of a real db-suite report (vitest 1.6.1), trimmed to 2 files. */
  const vitestReport = (files: { status: string; tests: string[] }[]) =>
    JSON.stringify({
      // The REAL top-level fields of that run, which disagree with the console:
      // it printed `295 passed | 7 skipped`, 12 files.
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
    // Real `tsc --noEmit --diagnostics` in packages/config (story 82.1).
    expect(
      parseTscDiagnostics(
        'Files:             168\nLines:          104596\nIdentifiers:     89023\n'
      )
    ).toMatchObject({ files: 168 })
    // `tsc --noEmit` without --diagnostics: silent on success.
    expect(parseTscDiagnostics('')).toBeNull()
    // The dead `pnpm tsc:web` script: exits without running a compiler.
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
    // A count-only summary (files checked) still only needs total > 0.
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

  it('the web suite keeps --no-file-parallelism and gets a per-run localStorage file', () => {
    expect(byId['web']?.args).toContain('--no-file-parallelism')
    expect(byId['web']?.env).toEqual({ NODE_OPTIONS: '--localstorage-file=/run/ls.db' })
    expect(byId['web']?.timeoutMs).toBe(25 * 60_000)
    // A NODE flag: on vitest's own CLI it crashes Node before vitest starts.
    expect(byId['web']?.args?.some((a) => a.includes('localstorage'))).toBe(false)
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

  it('the web suite APPENDS to an ambient NODE_OPTIONS instead of replacing it', () => {
    const [web] = buildGates({
      root: '/repo',
      runDir: '/run',
      typeCheckScripts: {},
      nodeOptions: '--max-old-space-size=8192',
    }).filter((g) => g.id === 'web')
    expect(web?.env?.['NODE_OPTIONS']).toBe(
      '--max-old-space-size=8192 --localstorage-file=/run/ls.db'
    )
  })

  it('e2e claims the three Playwright ports so the runner can refuse a stray server', () => {
    expect(byId['e2e']?.ports).toEqual([5173, 5174, 5175])
  })

  it('e2e blanks an ambient PLAYWRIGHT_BASE_URL (it would drop every webServer)', () => {
    expect(byId['e2e']?.env?.['PLAYWRIGHT_BASE_URL']).toBe('')
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
