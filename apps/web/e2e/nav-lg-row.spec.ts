import { expect, test } from '@playwright/test'
import {
  ACTIVE_BG,
  HOVER_BG,
  MORE_PANEL,
  MORE_SUMMARY,
  NAV,
  isMoreOpen,
  moreBackground,
  openMore,
  panelLabels,
  rowLabels,
} from './helpers/nav-more'

/**
 * Balances and Retirement return to the desktop row, from `lg` (story 69.3,
 * FR110). FREE tier (the `:5173` server). The paid half is
 * `nav-lg-row.paid.spec.ts`.
 *
 * Decision D1 (Lucas, 2026-09-25): the epic asked for "`sm` and up", and the
 * context pass MEASURED that it does not fit at 640px (the figures are in the
 * one width record, `nav-responsive-css.spec.ts`). So the two anchors join the
 * row at `lg` (1024px), and between 640 and 1023px the row is what it was.
 * Decision D2: they are two DOM copies switched by CSS, so "which one does a
 * user see" is a RENDERED fact, and only a real browser can answer it.
 *
 * ⚠️ Every read here is of RENDERED items. A CSS count of `nav a` counts both
 * copies at every width; that proves the DOM, not what anyone sees.
 */

const FREE_LG_ROW = ['Overview', 'Income', 'Expenses', 'Savings', 'Balances', 'Retirement']
const FIVE_ITEM_ROW = ['Overview', 'Income', 'Expenses', 'Savings', 'More']

test.describe('free desktop row at lg and up (AC-1)', () => {
  for (const width of [1024, 1280, 1920] as const) {
    test(`at ${width}px the free row is six anchors and there is NO More trigger`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      expect(await rowLabels(page), `the free row at ${width}px`).toEqual(FREE_LG_ROW)
      // Nothing is left behind More for a free session, so there is no trigger.
      // It is in the DOM (count 1) and NOT rendered: `toBeHidden()` alone would
      // also pass on a nav with no More anywhere (story 69.3 code review).
      await expect(page.locator(MORE_SUMMARY)).toHaveCount(1)
      await expect(page.locator(MORE_SUMMARY), 'a free More trigger renders at lg').toBeHidden()
      // One VISIBLE link each: the sheet copy is not rendered at this width.
      const nav = page.locator(NAV)
      for (const [name, href] of [
        ['Balances', '/balance'],
        ['Retirement', '/retirement'],
      ] as const) {
        const link = nav.getByRole('link', { name, exact: true })
        await expect(link, `${name} is not ONE visible link at ${width}px`).toHaveCount(1)
        await expect(link).toBeVisible()
        await expect(link).toHaveAttribute('href', href)
      }
    })
  }

  for (const [name, path] of [
    ['Balances', '/balance'],
    ['Retirement', '/retirement'],
  ] as const) {
    test(`the ${name} row anchor is current on its own page, reached in one click`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto('/income')
      await page.waitForLoadState('networkidle')
      await page.locator(NAV).getByRole('link', { name, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.locator(NAV).getByRole('link', { name, exact: true })).toHaveAttribute(
        'aria-current',
        'page'
      )
    })
  }

  // Code review of 69.3 (decision, Lucas 2026-09-25): a free More opened below
  // `lg` used to survive a resize into `lg` OPEN and invisible (listeners armed,
  // focus on <body>), and re-appear open when narrowed again.
  test('an open free More closes when the window widens into lg, and stays closed', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1023, height: 800 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await openMore(page)
    await page.setViewportSize({ width: 1024, height: 800 })
    await expect.poll(() => isMoreOpen(page), 'More stayed open across lg').toBe(false)
    await page.setViewportSize({ width: 1023, height: 800 })
    await expect(page.locator(MORE_PANEL), 'More re-appeared open below lg').toBeHidden()
    expect(await isMoreOpen(page)).toBe(false)
  })
})

test.describe('640-1023px is unchanged (AC-2)', () => {
  for (const width of [640, 800, 1023] as const) {
    test(`at ${width}px the free row is the five-item row, Balances and Retirement behind More`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      expect(await rowLabels(page), `the free row at ${width}px`).toEqual(FIVE_ITEM_ROW)
      await openMore(page)
      expect(await panelLabels(page)).toEqual(['Balances', 'Retirement'])
      await expect(
        page.locator(NAV).getByRole('link', { name: 'Balances', exact: true })
      ).toBeVisible()
    })
  }

  // A RECORD, not a proof (story 69.3 code review). The trigger's active
  // treatment on these two routes is `max-lg:`-scoped, a variant-scoped COLOUR.
  // What makes that safe for hover is specificity arithmetic (`:hover` is
  // 0-2-0, a media-scoped class 0-1-0), and this run cannot discriminate it:
  // hover would win with the scoping, without it, or with no active class at
  // all. It records the colour a user actually sees, beside the unprefixed
  // treatment's in `nav-lg-row.paid.spec.ts`.
  test('hover on the active More at 800px behaves as with the unprefixed treatment', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 800 })
    await page.goto('/balance')
    await page.waitForLoadState('networkidle')
    expect(await moreBackground(page)).toBe(ACTIVE_BG)
    await page.locator(MORE_SUMMARY).hover()
    const read = () =>
      page.locator(MORE_SUMMARY).evaluate((el) => getComputedStyle(el).backgroundColor)
    await expect.poll(read, 'hover on the active More').toBe(HOVER_BG)
    // eslint-disable-next-line no-console -- the measurement is recorded
    console.log('[69.3 hover] free /balance 800px:', await read())
  })

  for (const path of ['/balance', '/retirement'] as const) {
    test(`More is "you are here" on ${path} across the band, by computed style`, async ({
      page,
    }) => {
      for (const width of [640, 800, 1023]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        expect(await moreBackground(page), `More is not active on ${path} at ${width}px`).toBe(
          ACTIVE_BG
        )
      }
    })
  }
})
