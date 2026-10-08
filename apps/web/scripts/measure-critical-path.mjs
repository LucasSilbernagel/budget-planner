// Prints the client assets that must be fetched and evaluated before the Overview route
// runs: the start runtime awaits each route chunk's static graph before hydrating.

// Dynamic import() targets are deliberately excluded: moving an asset behind one is the
// improvement this measures. Byte counts are reproducible; timings aren't.

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(WEB_ROOT, 'dist', 'client')
const SERVER_ASSETS = join(WEB_ROOT, 'dist', 'server', 'assets')

function die(message) {
	console.error(`\n✗ ${message}\n`)
	process.exit(1)
}

/** Refuses to measure a build older than any input it was built from. */
function assertBuildIsFresh() {
	// Every build input, not just src/: a core edit, config change or dependency bump
	// all change the emitted bytes.
	const REPO_ROOT = join(WEB_ROOT, '..', '..')
	const inputs = [
		join(WEB_ROOT, 'src'),
		join(WEB_ROOT, 'vite.config.ts'),
		join(WEB_ROOT, 'package.json'),
		join(WEB_ROOT, 'pwa.config.mjs'),
		join(REPO_ROOT, 'pnpm-lock.yaml'),
		join(REPO_ROOT, 'packages', 'core', 'src'),
	]
	let newestSource = 0
	for (const input of inputs) {
		if (!existsSync(input)) continue
		newestSource = Math.max(newestSource, newestMtime(input))
	}

	const clientAssets = join(CLIENT, 'assets')
	if (!existsSync(clientAssets)) {
		die(`No build output at ${clientAssets}.\n  Run: pnpm --filter web build`)
	}
	const assetFiles = readdirSync(clientAssets)
	// An empty assets dir would leave oldestAsset at Infinity and pass vacuously.
	if (assetFiles.length === 0) {
		die(`${clientAssets} is empty — there is no build to measure.\n  Run: pnpm --filter web build`)
	}
	if (!existsSync(SERVER_ASSETS)) {
		die(`No server manifest at ${SERVER_ASSETS}.\n  Run: pnpm --filter web build`)
	}

	let oldestAsset = Number.POSITIVE_INFINITY
	for (const f of assetFiles) {
		oldestAsset = Math.min(oldestAsset, statSync(join(clientAssets, f)).mtimeMs)
	}
	// The manifest is read from dist/server, so a client-only rebuild must not pass.
	for (const f of readdirSync(SERVER_ASSETS)) {
		oldestAsset = Math.min(oldestAsset, statSync(join(SERVER_ASSETS, f)).mtimeMs)
	}
	if (newestSource > oldestAsset) {
		const src = new Date(newestSource).toISOString()
		const built = new Date(oldestAsset).toISOString()
		die(`STALE BUILD. Newest build INPUT is ${src}, but the build is from ${built}.
  Inputs watched: apps/web/{src,vite.config.ts,package.json,pwa.config.mjs}, pnpm-lock.yaml, packages/core/src
  Run: pnpm --filter web build`)
	}
}

function newestMtime(target) {
	const st = statSync(target)
	if (!st.isDirectory()) {
		return st.mtimeMs
	}
	let newest = st.mtimeMs
	for (const entry of readdirSync(target)) {
		newest = Math.max(newest, newestMtime(join(target, entry)))
	}
	return newest
}

async function loadManifest() {
	const file = readdirSync(SERVER_ASSETS).find((f) => f.startsWith('_tanstack-start-manifest_v-'))
	if (!file) die(`No SSR manifest under ${SERVER_ASSETS}. Did the build run?`)
	const mod = await import(pathToFileURL(join(SERVER_ASSETS, file)).href)
	return mod.tsrStartManifest()
}

function stylesheets() {
	return readdirSync(join(CLIENT, 'assets'))
		.filter((f) => f.endsWith('.css'))
		.map((f) => `/assets/${f}`)
}

function measure(urlPath) {
	const abs = join(CLIENT, urlPath.replace(/^\//, ''))
	const buf = readFileSync(abs)
	return {
		asset: basename(urlPath),
		raw: buf.length,
		gz: gzipSync(buf, { level: 9 }).length,
		// An occurrence count, not a boolean: a chunk that merely names the library differs
		// from one that bundles it.
		rechartsHits: (buf.toString('latin1').match(/recharts/g) ?? []).length,
	}
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

async function main() {
	assertBuildIsFresh()
	const manifest = await loadManifest()
	const root = manifest.routes.__root__
	const overview = manifest.routes['/']
	if (!overview) die('Route "/" is absent from the SSR manifest.')

	const scriptSrcs = (root.scripts ?? []).map((s) => s.attrs?.src).filter(Boolean)
	const urls = [
		...new Set([
			...scriptSrcs,
			...(root.preloads ?? []),
			...stylesheets(),
			...(overview.preloads ?? []),
		]),
	]

	const rows = urls.map(measure).sort((a, b) => b.raw - a.raw)
	const total = rows.reduce((acc, r) => ({ raw: acc.raw + r.raw, gz: acc.gz + r.gz }), {
		raw: 0,
		gz: 0,
	})
	// A chunk that bundles the library, not one that merely names a CSS class.
	const VENDOR_HIT_FLOOR = 10
	const recharts = rows.filter((r) => r.rechartsHits >= VENDOR_HIT_FLOOR)

	let commit = 'unknown'
	try {
		commit = execSync('git rev-parse --short HEAD', { cwd: WEB_ROOT }).toString().trim()
	} catch {
		/* not a git checkout — the table is still valid */
	}

	if (process.argv.includes('--json')) {
		console.log(JSON.stringify({ commit, rows, total, assetCount: rows.length }, null, 2))
		return
	}

	console.log(`\nM1 — Overview critical-path payload @ ${commit}\n`)
	console.log('| Asset | Raw | Gzip | `recharts` hits |')
	console.log('|---|---:|---:|:--:|')
	for (const r of rows) {
		const flag =
			r.rechartsHits === 0 ? '' : r.rechartsHits >= 10 ? `⚠️ ${r.rechartsHits}` : `${r.rechartsHits}`
		console.log(`| \`${r.asset}\` | ${kb(r.raw)} | ${kb(r.gz)} | ${flag} |`)
	}
	console.log(
		`| **TOTAL (${rows.length} assets)** | **${kb(total.raw)}** | **${kb(total.gz)}** | |`
	)
	console.log(
		`\nRecharts-BUNDLING assets on the critical path (>=${VENDOR_HIT_FLOOR} hits): ${
			recharts.length === 0
				? 'NONE'
				: recharts.map((r) => `${r.asset} (${r.rechartsHits} hits)`).join(', ')
		}`
	)
	if (recharts.length > 0) {
		const rgz = recharts.reduce((a, r) => a + r.gz, 0)
		console.log(
			`Their share of the gzipped critical path: ${((rgz / total.gz) * 100).toFixed(1)}% (${kb(
				rgz
			)} of ${kb(total.gz)})`
		)
	}
	console.log()
}

await main()
