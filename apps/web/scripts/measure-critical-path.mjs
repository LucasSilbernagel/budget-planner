/**
 * M1 — the Overview's critical-path payload (story 38.3, AC-1).
 *
 * Prints the exact set of client assets the browser must fetch AND evaluate
 * before the Overview route module can execute, with raw and gzip bytes each.
 *
 * ## Why this metric exists, and why it carries the improvement claim
 *
 * NFR9 demands a MEASURED before/after. A wall-clock millisecond figure is not
 * reproducible by a second person — it is a property of the machine that took it.
 * This number is a property of the BUILD: same commit in, same bytes out, on any
 * host. So M1 carries the improvement claim and M2 (`e2e/refresh-to-figures.spec.ts`)
 * carries only the user-facing one.
 *
 * ## Why these assets and not others
 *
 * `@tanstack/react-start`'s `hydrateStart.js:28` AWAITS `router.loadRouteChunk`
 * for every match before hydration begins. So the route chunk and its whole
 * STATIC import graph are on the critical path to the figures appearing — which
 * is precisely what the SSR manifest's `preloads` array enumerates. The root's
 * preloads and module script are on it too (they run first), as is the single
 * stylesheet `routes/__root.tsx` links.
 *
 * Dynamic `import()` targets are deliberately NOT here. That is the whole point:
 * moving an asset out of `preloads` and behind a dynamic import is the
 * improvement this script measures.
 *
 * ## Usage
 *
 *   pnpm --filter web build          # dist/ MUST be fresh — see the guard below
 *   node scripts/measure-critical-path.mjs
 *   node scripts/measure-critical-path.mjs --json   # machine-readable
 *
 * ⚠️ The staleness guard is load-bearing. When story 38.3 was written, the `dist/`
 * on disk was timestamped 18:04 while the two commits it supposedly reflected were
 * 19:15 and 22:53 — a build from BEFORE the epic, quoted by two separate research
 * passes as if it were current. This script refuses to print a number from a build
 * older than the newest source file it depends on.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

/**
 * Refuse to measure a build older than the source it came from.
 *
 * Compares the newest mtime under `src/` against the oldest mtime in
 * `dist/client/assets/`. A source file newer than the build means the numbers
 * below describe code that is no longer on disk.
 */
function assertBuildIsFresh() {
  // ⚠️ EVERY build input, not just `src/`. Code review measured the gap: a
  // `packages/core` edit, a `vite.config.ts` change or a dependency bump all alter
  // the emitted bytes without touching `apps/web/src`, so the original guard would
  // stamp "fresh" on numbers describing a build of different code — resurrecting the
  // exact incident this function was written to prevent, through a different door.
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
  // An empty assets directory left `oldestAsset` at Infinity, so freshness passed
  // vacuously against a build that emitted nothing.
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
  // The manifest is read from dist/server; a client-only rebuild would otherwise
  // enumerate preloads from a stale server manifest with the guard green.
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

/** Newest mtime under `target`, which may be a directory OR a single file. */
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

/** The one stylesheet `routes/__root.tsx` links, found by extension not by hash. */
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
    // Recorded because Recharts is the single largest lever the story names.
    //
    // ⚠️ This is an OCCURRENCE COUNT, not a boolean, and the distinction matters.
    //
    // ⚠️ It once said the route chunk's hits were "once or twice — CSS class names
    // the app writes". That was WRONG and the story's own measurement disproved it:
    // at the baseline the Overview route chunk carried **19** hits and real library
    // code (`Pie`, `PolarAngleAxis`, `PolarRadiusAxis` were inlined into it), and no
    // app source writes a `recharts-*` class at all — only e2e locators do. The
    // stale claim descended from a `grep -c` LINE count over minified output, taken
    // against a pre-story build. Corrected here because a comment asserting the
    // opposite of the measurement is how the next reader inherits the error.
    //
    // A count still beats a boolean: a chunk that merely names the library differs
    // from one that bundles it, and flattening the two would inflate the reported
    // share — precisely the unearned number NFR9 exists to prevent.
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

  // Order matters for readability, not for the total: the root's module script
  // and preloads are fetched first, then the route's own preload set.
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
  // A chunk that BUNDLES the library, not one that merely names a CSS class.
  // Measured at HEAD: the vendor chunk has 78 hits, the route chunk 1.
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
