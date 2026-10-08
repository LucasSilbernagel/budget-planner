import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HomePage } from '../components/HomePage'
import { GlobalNav } from '../components/layout/GlobalNav'
import { AccountNoticeBox } from '../components/overview/AccountNoticeBox'
import { NO_FLASH_PLANNER_SCRIPT } from '../lib/nav/no-flash-planner-visibility-script'
import { ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY } from '../lib/overview/account-notice-dismissal'
import { NO_FLASH_ACCOUNT_NOTICE_SCRIPT } from '../lib/overview/no-flash-account-notice-script'
import {
	NO_FLASH_OVERVIEW_DATA_SCRIPT,
	OVERVIEW_HAS_DATA_ATTRIBUTE,
} from '../lib/overview/no-flash-overview-data-script'
import { useIncomeStore } from '../stores/incomeStore'
import {
	PLANNER_VISIBILITY_STORAGE_KEY,
	usePlannerVisibilityStore,
} from '../stores/plannerVisibilityStore'
import { type CssRule, cssRules } from '../test/css-rules'

// jsdom has no cascade or paint: this pins the chain's source and selectors, not that the
// rule wins the cascade or that the first frame shows no flash.

const WEB = resolve(__dirname, '..', '..')
const GLOBAL_CSS = readFileSync(resolve(WEB, 'src/styles/global.css'), 'utf-8')
const ROOT_SOURCE = readFileSync(resolve(WEB, 'src/routes/__root.tsx'), 'utf-8')

function ruleStartingWith(prefix: string): CssRule {
	const hits = cssRules(GLOBAL_CSS).filter((rule) => rule.selector.startsWith(prefix))
	expect(hits, `expected exactly one global.css rule starting ${prefix}`).toHaveLength(1)
	return hits[0] as CssRule
}

// Applies at every width, theme and medium: only `@layer` may enclose it; `@media`,
// `@supports` or `@container` would scope the hide to some first frames only.
const appliesUnconditionally = (rule: CssRule) =>
	rule.atRules.every((prelude) => /^@layer\b/.test(prelude))

function lastDisplay(body: string): string | undefined {
	const values = [...body.matchAll(/(?:^|;)\s*display\s*:\s*([^;!]+)(!important)?/g)].map((m) =>
		(m[1] as string).trim()
	)
	return values.at(-1)
}

async function firstFrame(ui: () => React.ReactElement) {
	const rootRoute = createRootRoute({ component: ui })
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ['/'] }),
	})
	await router.load()
	const container = document.createElement('div')
	container.innerHTML = renderToString(<RouterProvider router={router} />)
	document.body.appendChild(container)
	return container
}

const runBootstrap = (script: string) => new Function(script)()

beforeEach(() => {
	localStorage.clear()
	document.documentElement.removeAttribute('data-hide-retirement')
	document.documentElement.removeAttribute('data-dismiss-account-notice')
	document.documentElement.removeAttribute(OVERVIEW_HAS_DATA_ATTRIBUTE)
	usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
})
afterEach(() => {
	document.body.innerHTML = ''
	document.documentElement.removeAttribute('data-hide-retirement')
	document.documentElement.removeAttribute('data-dismiss-account-notice')
	document.documentElement.removeAttribute(OVERVIEW_HAS_DATA_ATTRIBUTE)
	localStorage.clear()
})

describe('pre-paint suppression — the <head> wiring (__root.tsx)', () => {
	it('emits all three bootstraps as inline scripts INSIDE <head>, before <HeadContent />, never deferred', () => {
		// The JSX elements on their own lines, not a `<head>` mention in a comment.
		const open = ROOT_SOURCE.search(/\n\s*<head>\n/)
		const close = ROOT_SOURCE.search(/\n\s*<\/head>\n/)
		expect(open, 'no <head> element in __root.tsx').toBeGreaterThan(-1)
		expect(close, 'no </head> after <head>').toBeGreaterThan(open)
		const head = ROOT_SOURCE.slice(open, close)
		const headContentAt = head.indexOf('<HeadContent />')
		expect(headContentAt, 'no <HeadContent /> inside <head>').toBeGreaterThan(-1)
		for (const name of [
			'NO_FLASH_PLANNER_SCRIPT',
			'NO_FLASH_ACCOUNT_NOTICE_SCRIPT',
			'NO_FLASH_OVERVIEW_DATA_SCRIPT',
		]) {
			const tag = head.match(
				new RegExp(`<script[^>]*dangerouslySetInnerHTML=\\{\\{ __html: ${name} \\}\\}[^>]*/>`)
			)
			expect(tag, `${name} is not an inline <script> inside <head>`).not.toBeNull()
			expect(tag?.[0], `${name} is deferred`).not.toMatch(/\b(async|defer|src|type)\b/)
			// Before `<HeadContent />`, so nothing in <head> can paint before the mark is set.
			expect(head.indexOf(tag?.[0] as string), `${name} comes after <HeadContent />`).toBeLessThan(
				headContentAt
			)
			expect(
				ROOT_SOURCE.split(`__html: ${name}`).length - 1,
				`${name} is emitted more than once`
			).toBe(1)
		}
	})
})

describe('pre-paint suppression — the Retirement nav entry (story 35.2)', () => {
	const rule = () => ruleStartingWith('[data-hide-retirement="1"]')

	it('global.css hides it with display: none, unscoped by any @media/@supports', () => {
		expect(lastDisplay(rule().body), rule().body).toBe('none')
		expect(
			appliesUnconditionally(rule()),
			`the rule is scoped by: ${rule().atRules.join(' > ')}`
		).toBe(true)
	})

	it('once the real bootstrap marks <html>, the rule matches every server-rendered Retirement entry and no other nav node', async () => {
		localStorage.setItem(
			PLANNER_VISIBILITY_STORAGE_KEY,
			JSON.stringify({ state: { showRetirementPlanner: false }, version: 0 })
		)
		runBootstrap(NO_FLASH_PLANNER_SCRIPT)
		const container = await firstFrame(() => <GlobalNav />)

		const entries = container.querySelectorAll('li[data-nav-path="/retirement"]')
		expect(entries, 'the server HTML lost a Retirement copy').toHaveLength(2)
		const matched = [...document.querySelectorAll(rule().selector)]
		expect(matched).toHaveLength(2)
		for (const el of matched) expect(el.getAttribute('data-nav-path')).toBe('/retirement')
	})

	// The bootstrap has two "not hidden" paths. persist writes the key even under
	// `skipHydration`, so the first case must remove it again.
	it.each([
		['nothing was ever persisted', () => localStorage.removeItem(PLANNER_VISIBILITY_STORAGE_KEY)],
		[
			'the planner is persisted as visible',
			() =>
				localStorage.setItem(
					PLANNER_VISIBILITY_STORAGE_KEY,
					JSON.stringify({ state: { showRetirementPlanner: true }, version: 0 })
				),
		],
	])('matches nothing when %s (positive control)', async (_case, seed) => {
		seed()
		runBootstrap(NO_FLASH_PLANNER_SCRIPT)
		const container = await firstFrame(() => <GlobalNav />)
		expect(container.querySelectorAll('li[data-nav-path="/retirement"]')).toHaveLength(2)
		expect(document.querySelectorAll(rule().selector)).toHaveLength(0)
	})
})

describe('pre-paint suppression — the dismissed account notice (story 55.1)', () => {
	const rule = () => ruleStartingWith('[data-dismiss-account-notice="1"]')

	it('global.css hides it with display: none, unscoped by any @media/@supports', () => {
		expect(lastDisplay(rule().body), rule().body).toBe('none')
		expect(
			appliesUnconditionally(rule()),
			`the rule is scoped by: ${rule().atRules.join(' > ')}`
		).toBe(true)
	})

	it('once the real bootstrap marks <html>, the rule matches the server-rendered box', async () => {
		localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, '1')
		runBootstrap(NO_FLASH_ACCOUNT_NOTICE_SCRIPT)
		const container = await firstFrame(() => <AccountNoticeBox />)

		const box = container.querySelector('[data-account-notice]')
		expect(box, 'the server HTML lost the box (the SEO fence forbids that)').not.toBeNull()
		expect([...document.querySelectorAll(rule().selector)]).toEqual([box])
	})

	it('matches nothing when the notice was never dismissed (positive control)', async () => {
		runBootstrap(NO_FLASH_ACCOUNT_NOTICE_SCRIPT)
		const container = await firstFrame(() => <AccountNoticeBox />)
		expect(container.querySelector('[data-account-notice]')).not.toBeNull()
		expect(document.querySelectorAll(rule().selector)).toHaveLength(0)
	})
})

// This chain RESERVES space instead of hiding: the pending block is one viewport tall so
// its growth into the charts happens below the fold.
describe('pre-paint reservation — the Overview pending block (story 117.2)', () => {
	const rule = () => ruleStartingWith(`[${OVERVIEW_HAS_DATA_ATTRIBUTE}="1"]`)

	it('global.css gives it min-height: 100vh, unscoped by any @media/@supports', () => {
		expect(rule().body.replace(/\s+/g, ' ').trim()).toMatch(/(^|;)\s*min-height: 100vh;?$/)
		expect(
			appliesUnconditionally(rule()),
			`the rule is scoped by: ${rule().atRules.join(' > ')}`
		).toBe(true)
	})

	it('once the real bootstrap marks <html>, the rule matches exactly the server-rendered pending block', async () => {
		useIncomeStore.setState({ incomeSources: [{ id: 'row-1' }] } as never)
		runBootstrap(NO_FLASH_OVERVIEW_DATA_SCRIPT)
		useIncomeStore.setState({ incomeSources: [] } as never)
		const container = await firstFrame(() => <HomePage />)

		const pending = container.querySelector('[data-testid="overview-sections-skeleton"]')
		expect(pending, 'the server HTML lost the pending block').not.toBeNull()
		expect([...document.querySelectorAll(rule().selector)]).toEqual([pending])
	})

	it('matches nothing in a browser with no budget rows (positive control)', async () => {
		runBootstrap(NO_FLASH_OVERVIEW_DATA_SCRIPT)
		const container = await firstFrame(() => <HomePage />)
		expect(container.querySelector('[data-testid="overview-sections-skeleton"]')).not.toBeNull()
		expect(document.querySelectorAll(rule().selector)).toHaveLength(0)
	})
})
