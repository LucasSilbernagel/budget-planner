import { describe, expect, it } from 'vitest'
import { DOC_PAGES } from '../../content/docs'
import { Route as RootRoute } from '../__root'
import {
	globbedPagePaths,
	globKeyToRoutesRel,
	isPageRouteFile,
	ROUTES_DIR,
	routeModules,
	toRoutePath,
	walkRouteFiles,
} from './route-discovery'

// The glob and the filesystem walk share isPageRouteFile/toRoutePath, so only the hand list
// is independent of that code: mutate the classifier and confirm the suites go red.

const EXPECTED_ROUTE_PATHS = [
	'/',
	'/balance',
	'/categories',
	'/contact',
	'/docs',
	'/docs/$docId',
	'/expenses',
	'/financial-summary',
	'/forecasting',
	'/income',
	'/login',
	'/pricing',
	'/privacy',
	'/profiles',
	'/refund',
	'/retirement',
	'/savings',
	'/settings',
	'/terms',
	'/welcome',
] as const

// A real DOC_PAGES entry, so a head reading a field the content model lacks fails.
const HEAD_ARGS: Record<string, unknown> = {
	'/docs/$docId': {
		params: { docId: DOC_PAGES[0]?.slug },
		loaderData: { doc: DOC_PAGES[0] },
	},
}

type MetaEntry = {
	title?: string
	name?: string
	property?: string
	content?: string
}

function headMetaFor(routePath: string, mod: unknown): MetaEntry[] {
	const route = (
		mod as { Route?: { options?: { head?: (arg: unknown) => { meta?: MetaEntry[] } } } }
	).Route
	const head = route?.options?.head
	if (!head) return []
	try {
		return head(HEAD_ARGS[routePath] ?? {})?.meta ?? []
	} catch (cause) {
		throw new Error(
			`head() threw for ${routePath} — if it reads loaderData, add a HEAD_ARGS fixture for it`,
			{ cause }
		)
	}
}

function titleOf(meta: MetaEntry[]): string | undefined {
	return meta.find((m) => 'title' in m)?.title
}

function descriptionOf(meta: MetaEntry[]): string | undefined {
	return meta.find((m) => m.name === 'description')?.content
}

// An async head would leave `.meta` undefined, so refuse that.
const rootHead = RootRoute.options.head?.({} as never)
if (rootHead instanceof Promise) throw new Error('__root head() is async: read it with await')
const rootMeta = (rootHead?.meta ?? []) as MetaEntry[]
const ROOT_DESCRIPTION = descriptionOf(rootMeta)
const ROOT_TITLE = titleOf(rootMeta)

async function importRoute(routePath: string): Promise<unknown> {
	const globKey = Object.keys(routeModules).find((k) => {
		const rel = globKeyToRoutesRel(k)
		return isPageRouteFile(rel) && toRoutePath(rel) === routePath
	})
	const loader = globKey === undefined ? undefined : routeModules[globKey]
	if (!loader) {
		throw new Error(`no route module found for ${routePath}`)
	}
	return loader()
}

describe('route discovery', () => {
	it('the compile-time glob and a real filesystem walk find the SAME page routes', () => {
		const walkedPagePaths = walkRouteFiles(ROUTES_DIR)
			.filter(isPageRouteFile)
			.map(toRoutePath)
			.sort()
		// Narrowing the glob pattern above breaks this and nothing else would.
		expect(globbedPagePaths).toEqual(walkedPagePaths)
	})

	it('discovers exactly the page routes this app has', () => {
		expect(globbedPagePaths).toEqual([...EXPECTED_ROUTE_PATHS].sort())
	})

	it('the root default is available to compare against', () => {
		// Otherwise the not-the-root-default checks below compare against undefined.
		expect(ROOT_TITLE).toBeTruthy()
		expect(ROOT_DESCRIPTION).toBeTruthy()
	})
})

describe('every page route names itself', () => {
	// Iterates the discovered set, not the hand list, so weakening the discovery test cannot
	// turn this into a spot-check.
	for (const routePath of globbedPagePaths) {
		it(`${routePath} sets its own title and description`, async () => {
			const meta = headMetaFor(routePath, await importRoute(routePath))

			const title = titleOf(meta)
			const description = descriptionOf(meta)

			// TanStack skips an empty-string title. The convention regex below, not this line, is what
			// catches ''.
			expect(title, `${routePath} has no <title> of its own`).toBeTruthy()
			expect(description, `${routePath} has no meta description of its own`).toBeTruthy()

			// The suffix carries the brand, so separate brand or not-root checks would be dead.
			expect(title, `${routePath} does not follow "<Page> · Longhand Budget"`).toMatch(
				/ · Longhand Budget$/
			)

			expect(description, `${routePath} still serves the root default description`).not.toBe(
				ROOT_DESCRIPTION
			)

			// Exactly one of each: find() takes the first match, the renderer keeps the last.
			expect(
				meta.filter((m) => 'title' in m),
				`${routePath} declares more than one title`
			).toHaveLength(1)
			expect(
				meta.filter((m) => m.name === 'description'),
				`${routePath} declares more than one description`
			).toHaveLength(1)
		})
	}

	// One test, not state shared across `it`s, so shuffle, filters or retries cannot make it vacuous.
	it('no two routes share a title', async () => {
		const byTitle = new Map<string, string[]>()
		for (const routePath of globbedPagePaths) {
			const title = titleOf(headMetaFor(routePath, await importRoute(routePath)))
			if (title === undefined) continue
			byTitle.set(title, [...(byTitle.get(title) ?? []), routePath])
		}
		const clashes = [...byTitle.entries()].filter(([, paths]) => paths.length > 1)
		expect(clashes, `routes sharing a title: ${JSON.stringify(clashes)}`).toEqual([])
	})
})

describe('pre-existing titles are unchanged', () => {
	const PINNED: Record<string, string> = {
		'/categories': 'Categories · Longhand Budget',
		'/settings': 'Settings · Longhand Budget',
		'/financial-summary': 'Financial Summary · Longhand Budget',
		'/contact': 'Contact · Longhand Budget',
		'/pricing': 'Pricing · Longhand Budget',
		'/terms': 'Terms of Service · Longhand Budget',
		'/privacy': 'Privacy Policy · Longhand Budget',
		'/refund': 'Refund & Cancellation Policy · Longhand Budget',
	}

	for (const [routePath, expected] of Object.entries(PINNED)) {
		it(`${routePath} still reads exactly "${expected}"`, async () => {
			expect(titleOf(headMetaFor(routePath, await importRoute(routePath)))).toBe(expected)
		})
	}
})

// head() also runs while the loader is pending and on notFound, hence both branches.
describe('/docs/$docId head branches', () => {
	it('has documents to assert against', () => {
		// Without this, every per-doc assertion below would vacuously pass on an
		// empty list — the loop would simply not run.
		expect(DOC_PAGES.length).toBeGreaterThan(0)
	})

	// `toBe(doc.description)` also passes with both sides undefined, hence the non-empty checks.
	for (const doc of DOC_PAGES) {
		it(`/docs/${doc.slug} is named for its own document`, async () => {
			const mod = await importRoute('/docs/$docId')
			const head = (mod as { Route: { options: { head: (a: unknown) => { meta?: MetaEntry[] } } } })
				.Route.options.head
			const meta = head({ params: { docId: doc.slug }, loaderData: { doc } })?.meta ?? []

			expect(doc.title, `DOC_PAGES entry ${doc.slug} has no title`).toBeTruthy()
			expect(doc.description, `DOC_PAGES entry ${doc.slug} has no description`).toBeTruthy()
			expect(titleOf(meta)).toBe(`${doc.title} · Longhand Budget`)
			expect(descriptionOf(meta)).toBe(doc.description)
		})
	}

	it('falls back to naming the section when no document is resolved', async () => {
		const mod = await importRoute('/docs/$docId')
		const head = (mod as { Route: { options: { head: (a: unknown) => { meta?: MetaEntry[] } } } })
			.Route.options.head
		const meta = head({})?.meta ?? []
		expect(titleOf(meta)).toBe('Documentation · Longhand Budget')
		expect(descriptionOf(meta)).toBeTruthy()
	})
})
