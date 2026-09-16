/**
 * Tests for the container entrypoint switch (Story 5-18, AC-2).
 *
 * The same image both serves traffic and applies migrations. Which one it does is
 * decided ONCE, at boot, from `APP_ENTRYPOINT` — never by a route and never by a
 * request, because Rapids (Knative Serving) offers no command override and an env
 * var is the only lever the platform gives us (see the story's D1).
 *
 * Two properties are asserted here, in both directions:
 *   1. the switch itself — only the exact string `migrate` selects migrate mode;
 *   2. the module graph — in migrate mode the built application server is never
 *      imported, so the SSR and `/api/*` routes do not exist in that process.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// @ts-expect-error - .mjs entrypoint helper has no type declarations; behaviour is asserted below.
import { MIGRATE_ENTRYPOINT, selectEntrypoint } from '../entrypoint.mjs'

function readWebFile(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), 'utf8')
}

describe('selectEntrypoint', () => {
  it('selects migrate mode for the exact opt-in string', () => {
    expect(selectEntrypoint({ APP_ENTRYPOINT: 'migrate' })).toBe('migrate')
    expect(MIGRATE_ENTRYPOINT).toBe('migrate')
  })

  it('serves normally when the switch is absent', () => {
    expect(selectEntrypoint({})).toBe('serve')
    expect(selectEntrypoint({ APP_ENTRYPOINT: undefined })).toBe('serve')
  })

  // The serving container runs with whatever env the platform carries. Anything
  // that is not the exact opt-in must keep serving: a near-miss that silently
  // migrated instead of serving would take the site down, and a near-miss that
  // silently served instead of migrating is caught by the pipeline's own polling.
  it.each([
    ['', 'empty'],
    ['serve', 'the other mode'],
    ['Migrate', 'different case'],
    ['MIGRATE', 'upper case'],
    ['migrate ', 'trailing space'],
    [' migrate', 'leading space'],
    ['migrate,serve', 'a list'],
    ['true', 'a boolean-ish value'],
  ])('keeps serve mode for %j (%s)', (value) => {
    expect(selectEntrypoint({ APP_ENTRYPOINT: value })).toBe('serve')
  })
})

describe('module graph (AC-2: the migrate path is unreachable from a serving container)', () => {
  const dispatcher = readWebFile('server-entry.mjs')
  const serveEntry = readWebFile('serve-entry.mjs')
  const migrateEntry = readWebFile('migrate-entry.mjs')

  // The point of the dispatcher being tiny: importing it must not pull in either
  // branch. A static `import` of the app server here would load the whole SSR
  // route graph into the migrate process too, which is what AC-2 forbids.
  it('the dispatcher statically imports neither branch', () => {
    expect(dispatcher).not.toMatch(/^import[^\n]*['"]\.\/dist\/server\/server\.js['"]/m)
    expect(dispatcher).not.toMatch(/^import[^\n]*['"]\.\/serve-entry\.mjs['"]/m)
    expect(dispatcher).not.toMatch(/^import[^\n]*['"]\.\/migrate-entry\.mjs['"]/m)
  })

  it('the dispatcher reaches each branch by dynamic import only', () => {
    expect(dispatcher).toMatch(/import\(\s*['"]\.\/serve-entry\.mjs['"]\s*\)/)
    expect(dispatcher).toMatch(/import\(\s*['"]\.\/migrate-entry\.mjs['"]\s*\)/)
  })

  it('the serve branch is the only one that loads the built application server', () => {
    expect(serveEntry).toMatch(/from\s+['"]\.\/dist\/server\/server\.js['"]/)
    expect(migrateEntry).not.toMatch(/dist\/server\/server\.js/)
  })

  // Belt and braces on the same property: the migrate process has no route table
  // to expose, so it cannot serve the app even if it is reachable on the network.
  //
  // ⚠️ TRANSITIVE, not just the entry file. Code review 2026-09-15: checking only
  // `migrate-entry.mjs` would miss `migrate-status.mjs` or `migrate-runner.mjs`
  // later importing the app server — the import would be two hops away and the
  // guard would still be green. Walk the whole local module graph instead.
  it('no module reachable from the migrate branch imports the application server', () => {
    const forbidden = [/dist\/server\/server\.js/, /node-adapter\.mjs/, /routeTree/]

    const seen = new Set<string>()
    const queue = ['migrate-entry.mjs']
    const visited: string[] = []

    while (queue.length > 0) {
      const relative = queue.shift() as string
      if (seen.has(relative)) {
        continue
      }
      seen.add(relative)

      const source = readWebFile(relative)
      visited.push(relative)

      for (const pattern of forbidden) {
        expect(source, `${relative} must not reach the application server`).not.toMatch(pattern)
      }

      // Follow relative imports only — bare specifiers are node builtins or deps,
      // neither of which can pull in this app's routes.
      for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const target = match[1] as string
        const resolved = new URL(target, new URL(relative, 'file:///web/')).pathname.replace(
          /^\/web\//,
          ''
        )
        queue.push(resolved)
      }
    }

    // Guard the guard: if the traversal silently visited only the entry file, the
    // loop above would pass while proving nothing about the graph.
    expect(visited).toContain('migrate-entry.mjs')
    expect(visited).toContain('src/server/migrate-status.mjs')
    expect(visited).toContain('src/server/migrate-runner.mjs')
  })
})

/**
 * The migrate container is bound to the pipeline run that started it (code review
 * 2026-09-15, Lucas's call). Without that binding, a container left over from an
 * earlier run could answer this run's poll with a stale but perfectly well-formed
 * `succeeded` — and the release would proceed on a migration that never ran.
 *
 * The contract has two halves and both must hold, so both are pinned here: the
 * container REQUIRES `MIGRATE_RUN_ID` at boot and reports it back in the verdict,
 * and the pipeline REFUSES a verdict whose id is not the one it minted.
 */
describe('run-id binding (migrate container <-> pipeline run)', () => {
  const migrateEntry = readWebFile('migrate-entry.mjs')
  const workflow = readFileSync(
    new URL('../../../../../.github/workflows/deploy.yml', import.meta.url),
    'utf8'
  )

  // ⚠️ Changed 2026-09-16: the container used to EXIT on a missing run id, which
  // crash-looped it once the pipeline stripped credentials from the permanent
  // container (revision `budget-planner-migrator-00005`, CrashLoopBackOff). It now
  // idles instead. The safety property is unchanged and is what this asserts:
  // without a run id it does not migrate.
  it('will not migrate without a run id', () => {
    expect(migrateEntry).toMatch(/readEnv\('MIGRATE_RUN_ID'\)/)
    expect(migrateEntry).toMatch(/if \(!token \|\| !databaseUrl \|\| !runId\)/)

    const idleBranch =
      migrateEntry.split('if (!token || !databaseUrl || !runId) {')[1]?.split('} else {')[0] ?? ''
    expect(idleBranch).not.toMatch(/runMigration/)
  })

  it('the container reports its run id in the verdict', () => {
    expect(migrateEntry).toMatch(/status\['runId'\]\s*=\s*runId/)
  })

  it('the pipeline injects the run id and rejects a verdict that does not match', () => {
    expect(workflow).toMatch(/MIGRATE_RUN_ID=\$\{RUN_ID\}/)
    expect(workflow).toMatch(/reported_run.*!=.*RUN_ID/)
  })
})

/**
 * The migrate path runs `packages/db`'s own `drizzle-kit` and `tsx`, which are
 * devDependencies. They are in the image only because the runtime stage copies
 * the whole built tree after a `NODE_ENV=development` install — an incidental
 * property of a deliberately fat image, and one that a later "slim the image"
 * change (`pnpm deploy --prod`, `pnpm prune`, a narrower COPY) would remove
 * silently: the serving container would be unaffected and every unit test would
 * stay green while production migrations broke.
 *
 * So the invariant is asserted here rather than assumed.
 */
describe('Dockerfile (AC-2: the image actually carries the migrate payload)', () => {
  const dockerfile = readWebFile('Dockerfile')
  // Comments must be stripped before asserting on absence: the file discusses
  // `pnpm deploy --prod` in prose as a possible future optimisation, and a test
  // that matched that sentence would fail on documentation rather than on build
  // instructions.
  const instructions = dockerfile
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')

  it('starts the dispatcher, so both modes go through the entrypoint switch', () => {
    expect(instructions).toMatch(/CMD\s+\[\s*"node"\s*,\s*"apps\/web\/server-entry\.mjs"\s*\]/)
  })

  it('installs devDependencies in the build stage', () => {
    expect(instructions).toMatch(/NODE_ENV=development pnpm install --frozen-lockfile/)
  })

  it('copies the whole tree into the runtime stage and prunes nothing', () => {
    expect(instructions).toMatch(/COPY --from=build \/app \/app/)
    expect(instructions).not.toMatch(/pnpm prune/)
    expect(instructions).not.toMatch(/pnpm deploy/)
    expect(instructions).not.toMatch(/--prod\b/)
  })
})

/**
 * The verdict travels on TWO channels: a bearer-gated HTTP endpoint, and a
 * sentinel line in the container logs. The second exists because the first cannot
 * survive revision churn — Knative routes the container URL to whatever revision
 * is currently ready, which need not be the one that migrated. Live run
 * 35042874267-1 succeeded and then answered every poll with 401 from a successor.
 *
 * `.github/scripts/rapids_verdict.py` parses these lines, so the format is a
 * contract between two files in different languages. Pin both ends.
 */
describe('verdict sentinel (migrate container -> pipeline logs channel)', () => {
  const entry = readWebFile('migrate-entry.mjs')
  const parser = readFileSync(
    new URL('../../../../../.github/scripts/rapids_verdict.py', import.meta.url),
    'utf8'
  )

  it('is emitted on the success path and the unexpected-failure path', () => {
    expect(entry).toMatch(/emitVerdict\(result\)/)
    expect(entry).toMatch(/emitVerdict\(\{ state: 'failed'/)
  })

  it('carries this run id and the state', () => {
    expect(entry).toMatch(/run=\$\{runId\}/)
    expect(entry).toMatch(/state=\$\{result\.state\}/)
  })

  it('never carries a credential', () => {
    const emitFn = entry.split('function emitVerdict(')[1]?.split('\n}')[0] ?? ''
    expect(emitFn).not.toMatch(/token|DATABASE_URL|password|CA_CERT/i)
  })

  // If either side is reworded without the other, the pipeline silently stops
  // reading verdicts and every release times out. Keep the shapes aligned.
  it('matches the prefix the parser looks for', () => {
    expect(entry).toMatch(/\[migrate-entry\] VERDICT /)
    expect(parser).toMatch(/migrate-entry\\\]\\s\+VERDICT/)
  })
})
