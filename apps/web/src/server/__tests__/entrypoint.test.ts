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

	// A near-miss that migrated instead of serving would take the site down; one that
	// served instead of migrating is caught by the pipeline's polling.
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

	// Importing the dispatcher must not pull in either branch's module graph.
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
		expect(serveEntry).toMatch(/['"]\.\/dist\/server\/server\.js['"]/)
		expect(migrateEntry).not.toMatch(/dist\/server\/server\.js/)
	})

	// Transitive, not just the entry file: an import of the app server two hops away
	// must fail too.
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

/** Bound to the pipeline run, so a leftover container can't answer this run's poll with a stale `succeeded`. */
describe('run-id binding (migrate container <-> pipeline run)', () => {
	const migrateEntry = readWebFile('migrate-entry.mjs')
	const workflow = readFileSync(
		new URL('../../../../../.github/workflows/deploy.yml', import.meta.url),
		'utf8'
	)

	// Without a run id the container idles rather than migrating.
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
 * The migrate path needs packages/db's toolchain and the serving path doesn't, so a slimmed
 * image could break production migrations while every serve-path check stays green.
 */
describe('Dockerfile (AC-2: the image actually carries the migrate payload)', () => {
	const dockerfile = readWebFile('Dockerfile')
	// Comments are stripped so the assertions match build instructions, not prose.
	const instructions = dockerfile
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('#'))
		.join('\n')

	/** The text of one stage: from its `FROM … AS <name>` to the next `FROM`. */
	function stage(name: string): string {
		const parts = instructions.split(/^FROM\s+/m)
		const match = parts.find((part) =>
			new RegExp(`\\bAS\\s+${name}\\s*$`, 'm').test(part.split('\n')[0] ?? '')
		)
		return match ?? ''
	}

	const prodDeps = stage('prod-deps')
	const runtime = stage('runtime')

	it('has the stages these assertions read (non-vacuity)', () => {
		expect(stage('build')).toMatch(/pnpm --filter @budget-planner\/web build/)
		expect(prodDeps).not.toBe('')
		expect(runtime).not.toBe('')
	})

	it('starts the dispatcher, so both modes go through the entrypoint switch', () => {
		expect(runtime).toMatch(/CMD\s+\[\s*"node"\s*,\s*"apps\/web\/server-entry\.mjs"\s*\]/)
	})

	it('keeps the runtime contract: production env, unprivileged user, port 8080', () => {
		expect(runtime).toMatch(/ENV NODE_ENV=production/)
		expect(runtime).toMatch(/^USER node$/m)
		expect(runtime).toMatch(/^EXPOSE 8080$/m)
	})

	it('installs devDependencies in the build stage (vite and the Start plugin build the app)', () => {
		expect(stage('build')).toMatch(/NODE_ENV=development pnpm install --frozen-lockfile/)
	})

	it('no longer copies the whole built tree into the runtime stage', () => {
		expect(runtime).not.toMatch(/COPY --from=build \/app \/app\s*$/m)
	})

	it('installs production dependencies for BOTH the web app and packages/db', () => {
		expect(prodDeps).toMatch(/pnpm install --frozen-lockfile --prod\b/)
		expect(prodDeps).toMatch(/--filter @budget-planner\/web\b/)
		expect(prodDeps).toMatch(/--filter @budget-planner\/db\b/)
	})

	it('the migrate toolchain is a PRODUCTION dependency of packages/db, so --prod installs it', () => {
		const dbManifest = JSON.parse(
			readFileSync(new URL('../../../../../packages/db/package.json', import.meta.url), 'utf8')
		) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
		for (const name of ['drizzle-kit', 'tsx', 'dotenv', 'drizzle-orm', 'pg']) {
			expect(dbManifest.dependencies?.[name], name).toBeDefined()
			expect(dbManifest.devDependencies?.[name], name).toBeUndefined()
		}
	})

	it('carries the migrate payload: config, migrations and the lock/preflight sources', () => {
		expect(prodDeps).toMatch(/COPY packages\/db\/drizzle\.config\.ts packages\/db\//)
		expect(prodDeps).toMatch(/COPY packages\/db\/migrations packages\/db\/migrations/)
		expect(prodDeps).toMatch(/COPY packages\/db\/src packages\/db\/src/)
	})

	it('copies packages/db (payload + node_modules/.bin shims) to the path migrate-entry resolves', () => {
		expect(runtime).toMatch(/COPY --from=prod-deps \/app\/packages\/db \/app\/packages\/db/)
		expect(runtime).toMatch(/COPY --from=prod-deps \/app\/node_modules \/app\/node_modules/)
	})

	it('copies the serve payload: the built dist (with precompressed siblings) and the entry files', () => {
		expect(runtime).toMatch(/COPY --from=build \/app\/apps\/web\/dist \/app\/apps\/web\/dist/)
		expect(runtime).toMatch(
			/COPY --from=prod-deps \/app\/apps\/web\/node_modules \/app\/apps\/web\/node_modules/
		)
		for (const file of [
			'server-entry.mjs',
			'serve-entry.mjs',
			'migrate-entry.mjs',
			'package.json',
		]) {
			expect(runtime, file).toContain(`/app/apps/web/${file}`)
		}
		for (const file of [
			'entrypoint.mjs',
			'node-adapter.mjs',
			'migrate-runner.mjs',
			'migrate-status.mjs',
		]) {
			expect(runtime, file).toContain(`/app/apps/web/src/server/${file}`)
		}
	})
})

/**
 * Knative may route the container URL to a successor revision, so the verdict also travels as a
 * log sentinel parsed by the pipeline. Pin both ends of that cross-language contract.
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

	// Rewording either side alone silently stops the pipeline reading verdicts.
	it('matches the prefix the parser looks for', () => {
		expect(entry).toMatch(/\[migrate-entry\] VERDICT /)
		expect(parser).toMatch(/migrate-entry\\\]\\s\+VERDICT/)
	})
})
