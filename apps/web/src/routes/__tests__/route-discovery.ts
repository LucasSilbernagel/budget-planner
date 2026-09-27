import { lstatSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/**
 * Page-route discovery, shared by every test that must cover ALL page routes
 * (story 40.1's head coverage; story seo-1's robots/sitemap classification).
 *
 * Extracted rather than copied: a second walker is a second chance to be too
 * narrow, and the docblock on `isPageRouteFile` records a narrower walker that
 * passed 51/51 while missing a route. One classifier, fixed once.
 *
 * Lives in `__tests__/`, which both the TanStack route generator
 * (`routeFileIgnorePattern`, vite.config.ts) and `isPageRouteFile` exclude, so
 * this helper is never itself mistaken for a route.
 *
 * ⚠️ DO NOT REBUILD THIS ON `routeTree.gen.ts` — see route-head-coverage.test.ts.
 */

export const ROUTES_DIR = resolve(__dirname, '..')

/** Vite resolves this glob against the filesystem at transform time. */
export const routeModules = import.meta.glob('../**/*.{ts,tsx}')

/**
 * A route file is a PAGE route when it is neither the root document, nor a
 * server route, nor a test.
 *
 * ⚠️ THIS ACCEPTS `.ts` AS WELL AS `.tsx`, AND THAT IS LOAD-BEARING. The first
 * version matched `.tsx` only, on the unstated assumption that a page route
 * always contains JSX. It does not have to: a redirect-only or loader-only route
 * is legal TanStack file routing and needs no JSX. MEASURED — an untitled
 * `routes/zz-mutant.ts` passed the whole suite 51/51 GREEN, while the identical
 * route as `.tsx` went red.
 *
 * Worse, the extension check sat UPSTREAM of all three discovery opinions, so
 * the glob, the filesystem walk and the hand-written list agreed with each other
 * about a route none of them could see. THREE OPINIONS BEHIND ONE SHARED FILTER
 * ARE ONE OPINION. Server routes stay excluded by the explicit `api/` rule,
 * which is a stated rule rather than a side effect of how those files happen to
 * be written — that is what makes widening the extension safe.
 *
 * NOT handled, because this app uses none of them and a wrong guess would be
 * worse than a loud failure: route groups `(group)/`, pathless layouts
 * `_layout/`, and flat dot-notation (`docs.$docId.tsx`). Any of those derives a
 * route path matching nothing in the expected list and fails LOUDLY rather than
 * passing silently. Extend `toRoutePath` if the app adopts one.
 */
export function isPageRouteFile(relPath: string): boolean {
  const p = relPath.split(sep).join('/').replace(/^\.\//, '')
  if (!/\.tsx?$/.test(p)) return false
  if (p === '__root.tsx') return false
  if (p.startsWith('api/')) return false
  if (p.includes('__tests__/')) return false
  if (/\.(test|spec)\./.test(p)) return false
  // TanStack excludes `-`-prefixed files and directories from routing, so they
  // are colocated helpers, not pages, and must not be asked for a <title>.
  if (p.split('/').some((seg) => seg.startsWith('-'))) return false
  return true
}

/** `income.tsx` -> `/income`; `index.tsx` -> `/`; `docs/index.tsx` -> `/docs`. */
export function toRoutePath(relPath: string): string {
  const p = relPath.split(sep).join('/').replace(/^\.\//, '')
  // `.ts` as well as `.tsx`, matching `isPageRouteFile` — a `.ts` route must
  // derive `/foo`, not `/foo.ts`.
  const withoutExt = p.replace(/\.tsx?$/, '')
  if (withoutExt === 'index') return '/'
  return `/${withoutExt.replace(/\/index$/, '')}`
}

/** Real filesystem walk — independent of any build-time pattern. */
export function walkRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (lstatSync(abs).isDirectory()) {
      walkRouteFiles(abs, acc)
    } else {
      acc.push(relative(ROUTES_DIR, abs))
    }
  }
  return acc
}

/**
 * A glob key, made relative to `ROUTES_DIR` like a `walkRouteFiles` entry.
 *
 * ⚠️ Keys are relative to THIS file, which sits in `__tests__/`, so Vite writes
 * a sibling as `./x.ts`, not `../__tests__/x.ts`. Stripping `../` alone (what
 * the pre-extraction code did) turned `./x.ts` into `x.ts` — no `__tests__/`
 * segment left — so any non-test helper beside this file was classified as a
 * page route. MEASURED (story seo-1): the pre-extraction test, run with this
 * helper present, discovered `/route-discovery.ts` and went red. This file only
 * escapes its own glob because Vite excludes the importing module; the next
 * helper added here would not.
 */
export function globKeyToRoutesRel(key: string): string {
  if (key.startsWith('../')) return key.slice(3)
  if (key.startsWith('./')) return `${HELPER_DIR_REL}/${key.slice(2)}`
  return key
}

/**
 * This file's directory relative to `ROUTES_DIR` (`__tests__` today), derived
 * rather than written out so that moving the helper cannot silently revive the
 * sibling-classified-as-route bug described above.
 */
const HELPER_DIR_REL = relative(ROUTES_DIR, __dirname).split(sep).join('/')

/** Page routes as discovered by the compile-time glob, sorted. */
export const globbedPagePaths = Object.keys(routeModules)
  .map(globKeyToRoutesRel)
  .filter(isPageRouteFile)
  .map(toRoutePath)
  .sort()
