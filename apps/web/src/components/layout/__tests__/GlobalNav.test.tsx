import { afterEach, describe, expect, it } from 'vitest'
import { type SessionSeed, SessionSeedProvider } from '@/context/session-seed'
import { fireEvent, renderWithRouter, screen, waitFor, within } from '@/test/utils'

import { usePlannerVisibilityStore } from '../../../stores/plannerVisibilityStore'
import { DISCLOSURE_CHEVRON_CLASS } from '../../ui/ChevronDownIcon'
import { GlobalNav } from '../GlobalNav'

// Token membership, never substring: `toContain('fixed')` false-matches `max-sm:fixed`.

// Link counts are DOM presence, not reachability: jsdom doesn't hide a closed <details>. Don't
// "fix" them to the visible count; `toBeVisible()` is the matcher that respects `open`.
const PRIMARY_TABS: readonly [label: RegExp, href: string][] = [
	[/^overview$/i, '/'],
	[/^income$/i, '/income'],
	[/^expenses$/i, '/expenses'],
	[/^savings$/i, '/savings'],
]

const MORE_DESTINATIONS: readonly [label: RegExp, href: string][] = [
	[/^balances$/i, '/balance'],
	[/^retirement$/i, '/retirement'],
]

const SECTIONS: readonly [label: RegExp, href: string][] = [...PRIMARY_TABS, ...MORE_DESTINATIONS]

// Balances and Retirement have two DOM copies (sheet and `lg` row) and jsdom sees both, so
// scope role queries with `sheetOf`/`rowCopiesOf`, never `[0]`.
const PROMOTED_COPIES = MORE_DESTINATIONS.length

const SETTINGS_ROW = 1

const sheetOf = (nav: HTMLElement): HTMLElement => {
	const sheet = nav.querySelector('details > ul')
	expect(sheet, 'the More panel list is missing').not.toBeNull()
	return sheet as HTMLElement
}

const rowCopiesOf = (nav: HTMLElement): HTMLAnchorElement[] => [
	...nav.querySelectorAll<HTMLAnchorElement>(':scope > ul > li[data-nav-promoted] > a'),
]

/** Takes an element: an SVG's `className` is an SVGAnimatedString, not a string. */
const tokens = (el: Element): string[] => [...el.classList]

/** Never satisfy the icon tests by giving the chevron `sm:hidden`: it would hide it at every width. */
const ICON_SVG = 'svg:not([data-disclosure-chevron])'

/** Matched by property family, not palette name: a palette list lets other palettes through. */
const COLOUR_FAMILY =
	/^(bg|text|border|ring|divide|placeholder|caret|accent|outline|decoration|shadow|fill|stroke|from|via|to)-/

/** `max-sm:` typography (`text-[11px]`, `text-center`) shares colour prefixes and must be allowed. */
const NON_COLOUR: readonly RegExp[] = [
	/^text-(left|center|right|justify|start|end)$/,
	/^text-(xs|sm|base|lg|[2-9]?xl)$/,
	/^text-\[[^\]]*(px|rem|em|%|ch|vw|vh)\]$/,
	/^border(-[trblxy])?(-\d+)?$/,
	/^border-(solid|dashed|dotted|double|none|hidden|collapse|separate)$/,
	/^border-\[[^\]]*(px|rem|em)\]$/,
	/^ring(-\d+)?$/,
	/^ring-(inset|offset-\d+)$/,
	/^shadow(-(sm|md|lg|xl|2xl|inner|none))?$/,
	/^divide-[xy](-\d+)?$/,
	/^decoration-\d+$/,
	/^outline(-\d+|-none|-dashed|-dotted|-double)?$/,
	/^(from|via|to)-\d+%$/,
]

const isColourUtility = (base: string): boolean =>
	COLOUR_FAMILY.test(base) && !NON_COLOUR.some((pattern) => pattern.test(base))

describe('GlobalNav', () => {
	it('renders a nav landmark with an accessible name', async () => {
		renderWithRouter(<GlobalNav />)
		expect(await screen.findByRole('navigation', { name: /primary/i })).toBeInTheDocument()
	})

	it.each(SECTIONS)('exposes the %s section link to %s', async (name, href) => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const links = within(nav).getAllByRole('link', { name })
		const promoted = MORE_DESTINATIONS.some(([, h]) => h === href)
		expect(links).toHaveLength(promoted ? 2 : 1)
		for (const link of links) expect(link).toHaveAttribute('href', href)
	})

	it('exposes exactly the six top-level sections, as nine DOM anchors (no premium entry)', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })
		expect(within(nav).getAllByRole('link')).toHaveLength(
			SECTIONS.length + PROMOTED_COPIES + SETTINGS_ROW
		)
		expect(
			new Set(
				within(nav)
					.getAllByRole('link')
					.map((a) => a.getAttribute('href'))
			).size
		).toBe(SECTIONS.length + SETTINGS_ROW)
		expect(within(nav).queryByRole('link', { name: /forecast/i })).not.toBeInTheDocument()
	})

	// jsdom applies no stylesheet, so the per-width rule is pinned as tokens, via classList
	// (`max-sm:hidden` contains `sm:hidden` as a substring).
	it('carries exactly one /settings link: the LAST sheet row, phones only', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const links = nav.querySelectorAll('a[href="/settings"]')
		expect(links, 'expected exactly one /settings link in the nav').toHaveLength(1)
		expect(within(nav).getAllByRole('link', { name: 'Settings' })).toHaveLength(1)
		const link = links[0] as HTMLAnchorElement
		const sheet = sheetOf(nav)
		const li = sheet.lastElementChild as HTMLElement
		expect(li.contains(link), 'Settings is not the LAST row of the sheet').toBe(true)
		expect(li.tagName).toBe('LI')
		expect(li.parentElement, 'Settings is not a direct row of the sheet').toBe(sheet)
		const liTokens = tokens(li)
		expect(liTokens, 'the Settings row reaches >= 640px').toContain('sm:hidden')
		expect(liTokens).not.toContain('max-sm:hidden')
		expect(liTokens).not.toContain('lg:hidden')
		expect(li).not.toHaveAttribute('data-nav-promoted')
		expect(rowCopiesOf(nav).map((a) => a.getAttribute('href'))).not.toContain('/settings')
		expect(tokens(link)).toEqual(
			expect.arrayContaining(['max-sm:min-h-[44px]', 'max-sm:flex', 'max-sm:gap-3', 'sm:block'])
		)
		const balancesRow = within(sheet).getByRole('link', { name: /^balances$/i })
		expect(tokens(link)).toEqual(tokens(balancesRow))
		const icon = link.querySelector(ICON_SVG)
		expect(icon, 'the Settings row has no gear icon').not.toBeNull()
		expect(tokens(icon as Element)).toContain('sm:hidden')
		expect(link.querySelector('[data-nav-label]')?.textContent).toBe('Settings')
		expect(link).not.toHaveAttribute('aria-current')
		expect(tokens(link)).not.toContain('bg-green-50')
	})

	it.each(['/settings', '/Settings'])(
		'marks the Settings row, and only it, current on %s',
		async (path) => {
			renderWithRouter(<GlobalNav />, { path })
			const nav = await screen.findByRole('navigation', { name: /primary/i })
			const link = within(sheetOf(nav)).getByRole('link', { name: 'Settings' })
			expect(link).toHaveAttribute('aria-current', 'page')
			expect(tokens(link)).toContain('bg-green-50')
			const current = [...nav.querySelectorAll('[aria-current]')]
			expect(current, 'something else in the nav is current on /settings').toEqual([link])
		}
	)

	it('marks the current section with aria-current="page"', async () => {
		renderWithRouter(<GlobalNav />, { path: '/expenses' })
		const link = await screen.findByRole('link', { name: /^expenses$/i })
		expect(link).toHaveAttribute('aria-current', 'page')
	})

	it('does not mark Overview active on a sub-route (exact match on "/")', async () => {
		renderWithRouter(<GlobalNav />, { path: '/expenses' })
		// Expenses resolving active is the signal the router has settled.
		await screen.findByRole('link', { name: /^expenses$/i })
		expect(screen.getByRole('link', { name: /^overview$/i })).not.toHaveAttribute('aria-current')
	})

	it('marks Overview active only on the root route', async () => {
		renderWithRouter(<GlobalNav />, { path: '/' })
		const overview = await screen.findByRole('link', { name: /^overview$/i })
		expect(overview).toHaveAttribute('aria-current', 'page')
	})

	it('drives both layouts from ONE subtree — desktop and max-sm: utilities co-exist', async () => {
		renderWithRouter(<GlobalNav />)
		const navs = await screen.findAllByRole('navigation', { name: /primary/i })
		// A dual-render would put two identically named landmarks in the DOM.
		expect(navs, 'more than one Primary landmark is in the DOM').toHaveLength(1)
		const nav = navs[0]
		const list = nav.querySelector('ul')
		expect(list).not.toBeNull()

		expect(within(nav).getAllByRole('link')).toHaveLength(
			SECTIONS.length + PROMOTED_COPIES + SETTINGS_ROW
		)
		expect(tokens(nav)).toContain('max-sm:fixed')
		const listTokens = tokens(list as HTMLElement)
		expect(listTokens).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'max-sm:grid']))
	})

	it('lays the mobile bottom bar out as a 5-column grid (story 31.5)', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const list = nav.querySelector('ul')
		const listTokens = list ? tokens(list) : []

		expect(listTokens).toContain('max-sm:grid')
		expect(listTokens).toContain('max-sm:grid-cols-5')
		// A surviving desktop `gap-1 pl-4 py-2` would resize every grid track.
		expect(listTokens).toContain('max-sm:gap-0')
		expect(listTokens).toContain('max-sm:px-0')
		expect(listTokens).toContain('max-sm:py-0')
		expect(listTokens).toEqual(
			expect.arrayContaining(['flex', 'flex-wrap', 'gap-1', 'pl-4', 'py-2'])
		)
		expect(listTokens, 'the list regained its right padding').not.toContain('px-4')
	})

	it('nests the More destinations in ONE list, duplicated only as the lg row copies', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		const lists = nav.querySelectorAll('ul')
		expect(lists, 'expected exactly one outer list and one nested sheet list').toHaveLength(2)
		const [outer, sheet] = [...lists]
		expect(outer.contains(sheet), 'the sheet list is not nested inside the outer list').toBe(true)

		const barAnchors = [...outer.querySelectorAll(':scope > li:not([data-nav-promoted]) > a')]
		const sheetAnchors = [...sheet.querySelectorAll(':scope > li > a')]
		expect(barAnchors.map((a) => a.textContent?.trim())).toEqual([
			'Overview',
			'Income',
			'Expenses',
			'Savings',
		])
		expect(sheetAnchors.map((a) => a.textContent?.trim())).toEqual([
			'Balances',
			'Retirement',
			'Settings',
		])
		expect(rowCopiesOf(nav).map((a) => a.textContent?.trim())).toEqual(['Balances', 'Retirement'])

		const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))
		const counts = new Map<string | null, number>()
		for (const h of hrefs) counts.set(h, (counts.get(h) ?? 0) + 1)
		for (const [h, n] of counts) {
			const promoted = MORE_DESTINATIONS.some(([, href]) => href === h)
			expect(n, `${h} appears ${n} times in the nav DOM`).toBe(promoted ? 2 : 1)
		}
		for (const [, href] of MORE_DESTINATIONS) {
			const li = sheet.querySelector(`:scope > li[data-nav-path="${href}"]`)
			expect(li, `no sheet row for ${href}`).not.toBeNull()
			expect(tokens(li as Element), 'a promoted sheet row renders at lg too').toContain('lg:hidden')
		}
		for (const a of rowCopiesOf(nav)) {
			expect(tokens(a.parentElement as HTMLElement)).toEqual(['hidden', 'lg:block'])
			expect(a.querySelector('svg'), 'a row copy carries an icon').toBeNull()
		}

		const details = sheet.parentElement as HTMLElement
		expect(details.tagName, 'the sheet list is not the panel of a <details>').toBe('DETAILS')
		expect((details.parentElement as HTMLElement).tagName).toBe('LI')
	})

	it('carries one desktop-only chevron that turns on the `open` attribute', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		const chevrons = nav.querySelectorAll('[data-disclosure-chevron]')
		expect(chevrons, 'expected exactly one disclosure chevron in the nav').toHaveLength(1)
		const chevron = chevrons[0] as Element
		expect(
			chevron.closest('details > summary'),
			'the chevron is not in the More trigger'
		).not.toBeNull()
		expect(chevron).toHaveAttribute('aria-hidden', 'true')
		const chevronTokens = tokens(chevron)
		expect(chevronTokens).toEqual(
			expect.arrayContaining(['max-sm:hidden', 'group-open:rotate-180'])
		)
		expect(chevronTokens, 'the chevron is hidden at desktop').not.toContain('sm:hidden')
		expect(chevronTokens).toEqual(expect.arrayContaining(DISCLOSURE_CHEVRON_CLASS.split(' ')))
		const details = nav.querySelector('details') as HTMLDetailsElement
		expect(details, 'the <details> lost `group`').toHaveClass('group')
		const summary = nav.querySelector('details > summary') as HTMLElement
		expect(summary).toHaveAccessibleName('More')

		// Asserted open as well: a state-driven `rotate-180` is absent while closed too.
		expect(chevronTokens).not.toContain('rotate-180')
		fireEvent.click(summary)
		await waitFor(() => expect(details.open, 'the disclosure did not open').toBe(true))
		expect(
			tokens(nav.querySelector('[data-disclosure-chevron]') as Element),
			'the chevron rotates from React state — it must read the `open` attribute'
		).not.toContain('rotate-180')
	})

	/** Missed by the other sweeps: a <summary> has no testing-library role, so it is found by selector. */
	it('exposes a single More trigger, a <summary>, styled for both layouts', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		const summaries = nav.querySelectorAll('details > summary')
		expect(summaries, 'expected exactly one More <summary> in the nav').toHaveLength(1)
		expect(nav.querySelectorAll('button'), 'a <button> survived in the nav').toHaveLength(0)
		const trigger = summaries[0] as HTMLElement
		expect(trigger).toHaveAccessibleName('More')

		const triggerTokens = tokens(trigger)
		expect(triggerTokens).toEqual(
			expect.arrayContaining(['inline-block', 'rounded-md', 'px-3', 'py-2', 'text-sm'])
		)
		expect(triggerTokens).toContain('max-sm:flex-col')
		expect(triggerTokens).toContain('max-sm:min-h-[44px]')
		expect(triggerTokens).toContain('max-sm:text-[11px]')
		expect(triggerTokens).toContain('focus-visible:ring-2')
		expect(triggerTokens).toContain('max-sm:focus-visible:ring-inset')
		expect(triggerTokens, '`ring-inset` leaked onto the desktop trigger').not.toContain(
			'focus-visible:ring-inset'
		)
	})

	/** The native toggle must be the only hiding mechanism, or the panel never opens without JS. */
	it('hides the closed panel natively at every width, and by nothing else', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const sheet = [...nav.querySelectorAll('ul')][1]

		expect(sheet.hasAttribute('hidden'), 'the panel uses the `hidden` attribute').toBe(false)
		expect(tokens(sheet), 'a class-based closed state is layered on the native one').not.toContain(
			'max-sm:hidden'
		)
		expect(tokens(sheet)).not.toContain('hidden')
		// Closed means hidden, and jest-dom can see it: it respects `details[open]`.
		expect(within(sheet).getByRole('link', { name: /^balances$/i })).not.toBeVisible()
		// `absolute` against the fixed nav: `fixed` resolves `bottom: 100%` against the viewport.
		expect(tokens(sheet)).toContain('max-sm:absolute')
		expect(tokens(sheet), 'the sheet is `fixed` — it will render off-screen').not.toContain(
			'max-sm:fixed'
		)
		expect(tokens(sheet)).toContain('max-sm:bg-white')
		expect(tokens(sheet)).toContain('dark:max-sm:bg-gray-800')
	})

	/** Without `sm:hidden` an icon grows the desktop nav, and no geometry test notices. */
	it('scopes every icon to mobile with `sm:hidden`', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		const icons = [...nav.querySelectorAll(ICON_SVG)]
		expect(icons, 'expected one icon per destination plus the More trigger').toHaveLength(8)
		for (const icon of icons) {
			expect(
				tokens(icon),
				'an icon is missing `sm:hidden` — it will grow the desktop nav'
			).toContain('sm:hidden')
			expect(icon).toHaveAttribute('aria-hidden', 'true')
		}

		expect(nav.querySelectorAll('[data-nav-label]')).toHaveLength(10)
	})

	it('pads for the safe-area inset and stretches each mobile cell (story 18-2)', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })
		expect(tokens(nav)).toContain('max-sm:pb-[env(safe-area-inset-bottom)]')
		const anchor = within(nav).getByRole('link', { name: /^overview$/i })
		const anchorTokens = tokens(anchor)
		expect(anchorTokens).toContain('max-sm:h-full')
		expect(anchorTokens).toContain('max-sm:min-h-[44px]')
		expect(anchorTokens).toContain('max-sm:flex-col')
		expect(anchorTokens).toContain('max-sm:gap-0.5')
	})

	// Ink-only tokens: no geometric consequence, so nothing else can see them go missing.
	it('keeps the mobile cells square and their focus ring inset', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const anchorTokens = tokens(within(nav).getByRole('link', { name: /^overview$/i }))

		// `rounded-md` is unprefixed, so it reaches the mobile cells unless undone.
		expect(anchorTokens).toContain('rounded-md')
		expect(anchorTokens).toContain('max-sm:rounded-none')

		// The tracks are flush to the viewport edges, so an outset ring is clipped on the edge cells.
		expect(anchorTokens).toContain('focus-visible:ring-2')
		expect(anchorTokens).toContain('max-sm:focus-visible:ring-inset')
		expect(anchorTokens, '`ring-inset` leaked onto the desktop nav').not.toContain(
			'focus-visible:ring-inset'
		)
	})

	// An unprefixed `fixed` would make it a bottom bar at every width while passing mobile assertions.
	it('never positions the nav out of flow at desktop widths', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const navTokens = tokens(nav)

		for (const leaked of ['fixed', 'inset-x-0', 'bottom-0', 'z-40', 'border-t']) {
			expect(navTokens, `\`${leaked}\` is unprefixed — it reaches desktop too`).not.toContain(
				leaked
			)
		}
		// Below `sm` it is out of flow with its own chrome; none of that may be unprefixed.
		for (const token of navTokens) {
			if (token.includes(':')) continue
			expect(
				/^(fixed|absolute|sticky|inset-|bottom-|top-|left-|right-|z-|border|bg-|shadow)/.test(
					token
				),
				`the nav carries an unprefixed positioning/chrome utility (${token}) — it reaches desktop too`
			).toBe(false)
		}
		expect(navTokens, 'the flash-era `max-sm:border-b` chrome is still here').not.toContain(
			'max-sm:border-b'
		)
	})

	// A `max-sm:` colour on a link beats an unprefixed colour of equal specificity (it is emitted later).
	it('scopes only layout with max-sm: on the links — never colour', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		for (const anchor of within(nav).getAllByRole('link')) {
			const label = anchor.textContent?.trim()
			for (const token of tokens(anchor)) {
				const variants = token.split(':')
				const base = variants.pop() ?? token
				const scope = variants.find((v) => v.startsWith('max-'))
				if (!scope) continue
				expect(
					isColourUtility(base),
					`"${label}" carries a ${scope}:-scoped colour (${token}), which beats unprefixed colours of equal specificity in that range`
				).toBe(false)
			}
		}

		// Sweeps the whole subtree: the <nav> is the only element carrying `dark:max-sm:` tokens.
		const subtree = [nav, ...nav.querySelectorAll('*')] as HTMLElement[]
		for (const el of subtree) {
			for (const token of tokens(el)) {
				expect(
					token,
					`<${el.tagName.toLowerCase()}> uses \`max-sm:dark:\` — variant order must be \`dark:max-sm:\``
				).not.toContain('max-sm:dark:')
			}
		}
	})

	describe('the More tab is active on the routes it owns (two since story 69.2)', () => {
		// Non-null first: the `.not.toContain` cases would pass on a missing node.
		const moreTrigger = (nav: HTMLElement): HTMLElement => {
			const summary = nav.querySelector('details > summary')
			expect(summary, 'the More <summary> is missing').not.toBeNull()
			return summary as HTMLElement
		}

		it.each(MORE_DESTINATIONS)('is active below lg only on %s (%s)', async (_label, href) => {
			renderWithRouter(<GlobalNav />, { path: href })
			const nav = await screen.findByRole('navigation', { name: /primary/i })
			const sheetRow = await within(sheetOf(nav)).findByRole('link', { name: _label })
			expect(sheetRow).toHaveAttribute('aria-current', 'page')
			const rowCopy = rowCopiesOf(nav).find((a) => a.getAttribute('href') === href)
			expect(rowCopy, `no row copy for ${href}`).toBeDefined()
			expect(rowCopy).toHaveAttribute('aria-current', 'page')
			const triggerTokens = tokens(moreTrigger(nav))
			expect(triggerTokens, `the More tab is not marked active on ${href}`).toEqual(
				expect.arrayContaining(['max-lg:bg-green-50', 'max-lg:text-green-700'])
			)
			expect(triggerTokens, `the More tab is active at lg on ${href}`).not.toContain('bg-green-50')
			expect(triggerTokens).not.toContain('max-sm:bg-green-50')
		})

		it.each(PRIMARY_TABS)('is NOT active on %s (%s)', async (_label, href) => {
			renderWithRouter(<GlobalNav />, { path: href })
			const nav = await screen.findByRole('navigation', { name: /primary/i })
			await screen.findByRole('link', { name: _label })
			const triggerTokens = tokens(moreTrigger(nav))
			expect(triggerTokens, `the More tab is wrongly marked active on ${href}`).not.toContain(
				'bg-green-50'
			)
			expect(triggerTokens).not.toContain('max-lg:bg-green-50')
			expect(triggerTokens, `the /settings cue leaked onto ${href}`).not.toContain(
				'max-sm:bg-green-50'
			)
		})

		it.each(['/settings', '/Settings'])('is active below sm only on %s', async (path) => {
			renderWithRouter(<GlobalNav />, { path })
			const nav = await screen.findByRole('navigation', { name: /primary/i })
			await within(sheetOf(nav)).findByRole('link', { name: 'Settings' })
			const triggerTokens = tokens(moreTrigger(nav))
			expect(triggerTokens, `the More tab is not marked active on ${path}`).toEqual(
				expect.arrayContaining([
					'max-sm:bg-green-50',
					'max-sm:text-green-700',
					'dark:max-sm:bg-green-900/30',
					'dark:max-sm:text-green-300',
				])
			)
			expect(triggerTokens, 'More lights at >= 640px on /settings').not.toContain('bg-green-50')
			expect(triggerTokens, 'More lights at 640-1023px on /settings').not.toContain(
				'max-lg:bg-green-50'
			)
		})

		// Anti-vacuity: `bg-green-50` must really be the active treatment's token.
		it('uses the same active treatment the route tabs use', async () => {
			renderWithRouter(<GlobalNav />, { path: '/income' })
			const active = await screen.findByRole('link', { name: /^income$/i })
			expect(tokens(active)).toContain('bg-green-50')
		})
	})
})

// These counts drop because the Retirement <li> is not rendered at all, unlike the reachability
// note above.
describe('GlobalNav — Retirement planner hidden (story 35.2)', () => {
	const hidePlanner = () => usePlannerVisibilityStore.setState({ showRetirementPlanner: false })

	afterEach(() => {
		usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
	})

	it('omits the Retirement entry entirely when the preference is off', async () => {
		hidePlanner()
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		expect(within(nav).queryByRole('link', { name: /^retirement$/i })).toBeNull()
		expect(
			[...nav.querySelectorAll('a')].map((a) => a.getAttribute('href')),
			'the Retirement href survived the filter'
		).not.toContain('/retirement')
		expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length - 1 + 1 + SETTINGS_ROW)
		expect(rowCopiesOf(nav).map((a) => a.textContent?.trim())).toEqual(['Balances'])
	})

	it('leaves the sheet holding exactly its other destination, then Settings', async () => {
		hidePlanner()
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		const lists = nav.querySelectorAll('ul')
		const sheet = [...lists][1]
		expect(
			[...sheet.querySelectorAll(':scope > li > a')].map((a) => a.textContent?.trim())
		).toEqual(['Balances', 'Settings'])
	})

	it('drops exactly one icon and one label with the entry', async () => {
		hidePlanner()
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		expect([...nav.querySelectorAll(ICON_SVG)]).toHaveLength(7)
		expect(nav.querySelectorAll('[data-nav-label]')).toHaveLength(8)
	})

	it('leaves the four bar tabs and the More trigger untouched', async () => {
		hidePlanner()
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		const outer = [...nav.querySelectorAll('ul')][0]
		expect(
			[...outer.querySelectorAll(':scope > li:not([data-nav-promoted]) > a')].map((a) =>
				a.textContent?.trim()
			)
		).toEqual(['Overview', 'Income', 'Expenses', 'Savings'])
		expect(nav.querySelectorAll('details > summary')).toHaveLength(1)
	})

	it('does not mark the More trigger active on /retirement while hidden', async () => {
		hidePlanner()
		renderWithRouter(<GlobalNav />, { path: '/retirement' })
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		const summary = nav.querySelector('details > summary')
		expect(summary, 'the More <summary> is missing').not.toBeNull()
		expect(
			tokens(summary as HTMLElement),
			'the More tab claims a destination its sheet no longer holds'
		).not.toContain('bg-green-50')
		expect(tokens(summary as HTMLElement)).not.toContain('max-lg:bg-green-50')
	})

	it('restores the entry when the preference is switched back on', async () => {
		hidePlanner()
		const { unmount } = renderWithRouter(<GlobalNav />)
		const hiddenNav = await screen.findByRole('navigation', { name: /primary/i })
		// Assert the before state too, or a component that never filters would pass.
		expect(within(hiddenNav).getAllByRole('link')).toHaveLength(
			SECTIONS.length - 1 + 1 + SETTINGS_ROW
		)
		unmount()

		usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		expect(within(sheetOf(nav)).getByRole('link', { name: /^retirement$/i })).toHaveAttribute(
			'href',
			'/retirement'
		)
		expect(rowCopiesOf(nav).map((a) => a.getAttribute('href'))).toEqual(['/balance', '/retirement'])
		expect(within(nav).getAllByRole('link')).toHaveLength(
			SECTIONS.length + PROMOTED_COPIES + SETTINGS_ROW
		)
	})

	/** jsdom can't evaluate the pre-paint rule, but it can prove the attribute it selects on exists. */
	it('tags every destination <li> with its route for the pre-paint CSS hook', async () => {
		renderWithRouter(<GlobalNav />)
		const nav = await screen.findByRole('navigation', { name: /primary/i })

		const tagged = [...nav.querySelectorAll('li[data-nav-path]')].map((li) =>
			li.getAttribute('data-nav-path')
		)
		// The row copies must be tagged, or the pre-paint rule misses a hidden planner at `lg`.
		expect(tagged).toEqual([
			'/',
			'/income',
			'/expenses',
			'/savings',
			'/balance',
			'/retirement',
			'/balance',
			'/retirement',
			'/settings',
		])
	})
})

describe('GlobalNav — tier-aware destinations (story 58.1, FR87)', () => {
	const seedWith = (overrides: Partial<SessionSeed> = {}): SessionSeed => ({
		isAuthenticated: true,
		userId: 'u1',
		email: 'u1@example.test',
		subscriptionStatus: 'active',
		...overrides,
	})

	const renderWithSeed = (seed: SessionSeed | null, path = '/') =>
		renderWithRouter(
			<SessionSeedProvider seed={seed}>
				<GlobalNav />
			</SessionSeedProvider>,
			{ path }
		)

	const nav = () => screen.findByRole('navigation', { name: /primary/i })

	const sheetLabels = (navEl: HTMLElement): (string | undefined)[] => {
		const lists = [...navEl.querySelectorAll('ul')]
		const sheet = lists[1]
		return [...sheet.querySelectorAll(':scope > li > a')].map((a) => a.textContent?.trim())
	}

	const PREMIUM: readonly [label: string, href: string][] = [
		['Forecasting', '/forecasting'],
		['Profiles', '/profiles'],
		['Financial Summary', '/financial-summary'],
		['Categories', '/categories'],
	]

	const FREE_SHEET = ['Balances', 'Retirement', 'Settings']
	const PAID_SHEET = [
		'Balances',
		'Retirement',
		'Forecasting',
		'Profiles',
		'Financial Summary',
		'Categories',
		'Settings',
	]

	describe('an entitled session', () => {
		it('renders ten destinations as thirteen anchors', async () => {
			renderWithSeed(seedWith())
			const navEl = await nav()
			expect(within(navEl).getAllByRole('link')).toHaveLength(13)
			expect(rowCopiesOf(navEl).map((a) => a.textContent?.trim())).toEqual([
				'Balances',
				'Retirement',
			])
		})

		it('appends the four premium rows after the free rows, in order', async () => {
			renderWithSeed(seedWith())
			const navEl = await nav()
			expect(sheetLabels(navEl)).toEqual(PAID_SHEET)
			const cell = navEl.querySelector('details')?.parentElement as HTMLElement
			expect(tokens(cell)).not.toContain('lg:hidden')
		})

		it.each(PREMIUM)('links %s to %s', async (label, href) => {
			renderWithSeed(seedWith())
			const link = within(await nav()).getByRole('link', { name: label })
			expect(link).toHaveAttribute('href', href)
		})

		it('treats a lifetime purchase as entitled too', async () => {
			renderWithSeed(seedWith({ subscriptionStatus: 'lifetime' }))
			expect(within(await nav()).getAllByRole('link')).toHaveLength(13)
		})

		it('tags every new <li> with its route for the pre-paint CSS hook', async () => {
			renderWithSeed(seedWith())
			const tagged = [...(await nav()).querySelectorAll('li[data-nav-path]')].map((li) =>
				li.getAttribute('data-nav-path')
			)
			expect(tagged).toEqual([
				'/',
				'/income',
				'/expenses',
				'/savings',
				'/balance',
				'/retirement',
				'/balance',
				'/retirement',
				'/forecasting',
				'/profiles',
				'/financial-summary',
				'/categories',
				'/settings',
			])
		})

		it('scopes every new icon to mobile with `sm:hidden`', async () => {
			renderWithSeed(seedWith())
			const navEl = await nav()
			const icons = [...navEl.querySelectorAll(ICON_SVG)]
			expect(icons).toHaveLength(12)
			for (const icon of icons) {
				expect(tokens(icon), 'a premium icon is missing `sm:hidden`').toContain('sm:hidden')
				expect(icon).toHaveAttribute('aria-hidden', 'true')
			}
			expect(navEl.querySelectorAll('[data-nav-label]')).toHaveLength(14)
		})

		it.each(PREMIUM)('marks the More trigger active on %s', async (label, href) => {
			renderWithSeed(seedWith(), href)
			const navEl = await nav()
			expect(within(navEl).getByRole('link', { name: label })).toHaveAttribute(
				'aria-current',
				'page'
			)
			const summary = navEl.querySelector('details > summary')
			expect(summary, 'the More <summary> is missing').not.toBeNull()
			expect(tokens(summary as HTMLElement)).toContain('bg-green-50')
			expect(tokens(summary as HTMLElement)).not.toContain('max-sm:bg-green-50')
		})
	})

	describe('every non-entitled session is unchanged from before this story', () => {
		const NOT_ENTITLED: readonly [name: string, seed: SessionSeed | null][] = [
			['a free subscriber', seedWith({ subscriptionStatus: 'free' })],
			['a past_due subscriber', seedWith({ subscriptionStatus: 'past_due' })],
			['a canceled subscriber', seedWith({ subscriptionStatus: 'canceled' })],
			['a null subscription status', seedWith({ subscriptionStatus: null })],
			[
				'a signed-out session',
				{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null },
			],
			// A null seed is unverified, never entitled.
			['no seed at all (resolver errored)', null],
			// Fail-closed by construction, not by luck of what the resolver emits: a
			// malformed seed claiming `active` while not authenticated must not pass.
			[
				'an unauthenticated seed claiming active',
				{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: 'active' },
			],
		]

		it.each(NOT_ENTITLED)(
			'gives %s the unchanged six-destination free nav',
			async (_name, seed) => {
				renderWithSeed(seed)
				const navEl = await nav()
				expect(within(navEl).getAllByRole('link')).toHaveLength(9)
				expect(sheetLabels(navEl)).toEqual(FREE_SHEET)
				// The Settings sheet row must not un-hide this: a free desktop would get More over an empty dropdown.
				const cell = navEl.querySelector('details')?.parentElement as HTMLElement
				expect(tokens(cell), 'a free session keeps a More trigger at lg').toContain('lg:hidden')
			}
		)

		it.each(NOT_ENTITLED)(
			'keeps %s free of a More trigger at lg despite the Settings row',
			async (_name, seed) => {
				renderWithSeed(seed)
				const navEl = await nav()
				expect(sheetLabels(navEl).at(-1), 'the sheet lost its Settings row').toBe('Settings')
				const cell = navEl.querySelector('details')?.parentElement as HTMLElement
				expect(tokens(cell), 'Settings un-hid a free More at lg (empty dropdown)').toContain(
					'lg:hidden'
				)
			}
		)

		it.each(NOT_ENTITLED)('shows %s no premium destination', async (_name, seed) => {
			renderWithSeed(seed)
			const navEl = await nav()
			// Absence per destination, not just a count: a count stays 6 if one
			// premium row leaked in while an existing one dropped out.
			for (const [, href] of PREMIUM) {
				expect(navEl.querySelector(`a[href="${href}"]`), `${href} leaked into the free nav`).toBe(
					null
				)
			}
		})
	})

	describe('tier and the Retirement preference are independent filters', () => {
		afterEach(() => {
			usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
		})

		it('gives an entitled session with the planner hidden nine anchors and five rows', async () => {
			usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
			renderWithSeed(seedWith())
			const navEl = await nav()

			expect(within(navEl).getAllByRole('link')).toHaveLength(11)
			expect(sheetLabels(navEl)).toEqual([
				'Balances',
				'Forecasting',
				'Profiles',
				'Financial Summary',
				'Categories',
				'Settings',
			])
		})

		it('does not mark the More trigger active on /retirement while it is hidden', async () => {
			usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
			renderWithSeed(seedWith(), '/retirement')
			const summary = (await nav()).querySelector('details > summary')
			expect(summary, 'the More <summary> is missing').not.toBeNull()
			expect(tokens(summary as HTMLElement)).not.toContain('bg-green-50')
			expect(tokens(summary as HTMLElement)).not.toContain('max-lg:bg-green-50')
		})
	})

	it('never adds Multi-device sync, in either tier (AC-7)', async () => {
		for (const seed of [seedWith(), null]) {
			const { unmount } = renderWithSeed(seed)
			const navEl = await nav()
			expect(within(navEl).queryByRole('link', { name: /sync/i })).not.toBeInTheDocument()
			unmount()
		}
	})
})

// aria-query has no `summary` role, so `getByRole('button')` misses the trigger: locate
// `details > summary`. The onClick cancels the native toggle; React flips `open`.
describe('GlobalNav — the More disclosure at every width (story 59.2)', () => {
	const parts = async () => {
		const nav = await screen.findByRole('navigation', { name: /primary/i })
		const details = nav.querySelector('details')
		const summary = nav.querySelector('details > summary')
		const panel = nav.querySelector('details > ul')
		expect(details, 'the More disclosure is not a <details>').not.toBeNull()
		expect(summary, 'the <details> has no <summary> trigger').not.toBeNull()
		expect(panel, 'the panel list is not inside the <details>').not.toBeNull()
		return {
			nav,
			details: details as HTMLDetailsElement,
			summary: summary as HTMLElement,
			panel: panel as HTMLElement,
		}
	}

	it('is a native disclosure in the fifth cell, closed on the first render', async () => {
		renderWithRouter(<GlobalNav />)
		const { nav, details, summary, panel } = await parts()

		const outer = nav.querySelector('ul') as HTMLElement
		// The promoted row copies sit between Savings and More but are hidden below lg.
		const fifth = outer.querySelectorAll(':scope > li:not([data-nav-promoted])')[4]
		expect(fifth?.firstElementChild, 'the <details> is not the fifth cell').toBe(details)
		expect(details.firstElementChild, 'the <summary> must be the first child').toBe(summary)
		expect(summary).toHaveAccessibleName('More')
		// Closed on the first render, so the server and client agree.
		expect(details.open).toBe(false)
		expect(details).not.toHaveAttribute('open')
		expect(within(panel).getByRole('link', { name: /^balances$/i })).not.toBeVisible()
	})

	it('carries no hand-rolled ARIA — the platform supplies the expanded state', async () => {
		renderWithRouter(<GlobalNav />)
		const { summary, panel } = await parts()
		for (const attr of ['role', 'aria-expanded', 'aria-controls', 'aria-haspopup', 'type']) {
			expect(summary, `the summary carries a hand-rolled ${attr}`).not.toHaveAttribute(attr)
		}
		expect(panel).not.toHaveAttribute('role')
		expect(panel).not.toHaveAttribute('aria-modal')
		expect(
			within(screen.getByRole('navigation', { name: /primary/i })).queryAllByRole('button')
		).toHaveLength(0)
	})

	it('no longer dissolves into the desktop row, and overlays instead', async () => {
		renderWithRouter(<GlobalNav />)
		const { details, summary, panel } = await parts()
		const cell = details.parentElement as HTMLElement

		expect(tokens(cell), 'the fifth cell still dissolves at >= 640px').not.toContain('sm:contents')
		expect(tokens(panel), 'the panel still dissolves at >= 640px').not.toContain('sm:contents')
		expect(tokens(summary), 'the trigger is still hidden at >= 640px').not.toContain('sm:hidden')
		// The desktop overlay's containing block is the CELL, and only at >= 640px:
		// below `sm` the panel must keep resolving against the `max-sm:fixed` nav.
		expect(tokens(cell)).toContain('sm:relative')
		expect(tokens(cell)).not.toContain('relative')
		expect(tokens(panel)).toEqual(
			expect.arrayContaining([
				'sm:absolute',
				'sm:top-full',
				'sm:left-0',
				'sm:bg-white',
				'dark:sm:bg-gray-800',
				'sm:border',
				'sm:shadow-lg',
				'sm:overflow-y-auto',
			])
		)
		for (const leaked of ['absolute', 'fixed', 'top-full', 'bg-white']) {
			expect(tokens(panel), `\`${leaked}\` is unprefixed on the panel`).not.toContain(leaked)
		}
		// `list-none` is inert today; pinned for a future `display: list-item`.
		expect(tokens(summary)).toEqual(
			expect.arrayContaining(['list-none', '[&::-webkit-details-marker]:hidden'])
		)
		// The nav keeps its content width, so a wide account cluster yields instead of wrapping the row.
		const nav = screen.getByRole('navigation', { name: /primary/i })
		expect(tokens(nav), 'the nav can shrink — a signed-in cluster will wrap it').toContain(
			'sm:shrink-0'
		)
		expect(tokens(nav), '`shrink-0` must stay desktop-only').not.toContain('shrink-0')
	})

	it('keeps the mobile sheet half of the panel exactly as it was', async () => {
		renderWithRouter(<GlobalNav />)
		const { panel } = await parts()
		const mobile = tokens(panel).filter(
			(t) => t.startsWith('max-sm:') || t.startsWith('dark:max-sm:')
		)
		expect(mobile).toEqual([
			'max-sm:absolute',
			'max-sm:inset-x-0',
			'max-sm:bottom-full',
			'max-sm:max-h-[calc(100svh-5rem)]',
			'max-sm:overflow-y-auto',
			'max-sm:overscroll-contain',
			'max-sm:border-t',
			'max-sm:border-gray-200',
			'max-sm:bg-white',
			'max-sm:py-1',
			'dark:max-sm:border-gray-700',
			'dark:max-sm:bg-gray-800',
		])
	})

	it('opens on a summary click and closes on Escape, returning focus to the trigger', async () => {
		renderWithRouter(<GlobalNav />)
		const { details, summary, panel } = await parts()

		fireEvent.click(summary)
		expect(details.open).toBe(true)
		await waitFor(() =>
			expect(within(panel).getByRole('link', { name: /^balances$/i })).toBeVisible()
		)

		fireEvent.keyDown(document, { key: 'Escape' })
		await waitFor(() => expect(details.open).toBe(false))
		expect(summary).toHaveFocus()
	})

	it('adopts an open it did not cause, so Escape still closes it', async () => {
		// Find-in-page, script, or a late pre-hydration toggle change `open` without React;
		// only `onToggle` keeps state honest, or the listeners stay unarmed.
		renderWithRouter(<GlobalNav />)
		const { details } = await parts()
		details.open = true
		await waitFor(() =>
			expect(within(details).getByRole('link', { name: /^balances$/i })).toBeVisible()
		)
		fireEvent.keyDown(document, { key: 'Escape' })
		await waitFor(() =>
			expect(details.open, 'Escape did not close a script-opened panel').toBe(false)
		)
	})

	it('closes when the CURRENT bar tab is clicked', async () => {
		// Same-route click: no pathname change and the press is inside the nav, so only the tab closes it.
		renderWithRouter(<GlobalNav />, { path: '/income' })
		const { nav, details, summary } = await parts()
		fireEvent.click(summary)
		await waitFor(() => expect(details.open).toBe(true))
		fireEvent.click(within(nav).getByRole('link', { name: /^income$/i }))
		await waitFor(() =>
			expect(details.open, 'the panel survived a same-route tab click').toBe(false)
		)
	})

	it('Escape does not steal focus from page content outside the nav', async () => {
		renderWithRouter(
			<>
				<GlobalNav />
				<button type="button">Page action</button>
			</>
		)
		const { details, summary } = await parts()
		fireEvent.click(summary)
		await waitFor(() => expect(details.open).toBe(true))
		const pageButton = screen.getByRole('button', { name: 'Page action' })
		pageButton.focus()
		fireEvent.keyDown(document, { key: 'Escape' })
		await waitFor(() => expect(details.open).toBe(false))
		expect(pageButton, 'Escape yanked focus from page content to the trigger').toHaveFocus()
	})

	it('closes when a row is chosen', async () => {
		renderWithRouter(<GlobalNav />)
		const { details, summary, panel } = await parts()
		fireEvent.click(summary)
		await waitFor(() =>
			expect(within(panel).getByRole('link', { name: /^balances$/i })).toBeVisible()
		)
		fireEvent.click(within(panel).getByRole('link', { name: /^balances$/i }))
		await waitFor(() => expect(details.open).toBe(false))
	})
})
