import { expect, test } from '@playwright/test'
import {
  ACTIVE_BG,
  HOVER_BG,
  MORE_PANEL,
  MORE_SUMMARY,
  NAV,
  moreBackground,
  openMore,
  panelLabels,
  rowLabels,
} from './helpers/nav-more'

/**
 * Balances and Retirement on the desktop row, PAID tier (story 69.3, FR110).
 * Runs on the `:5174` server, whose SSR seed is entitled, so the nav is the
 * paid nav from the first frame. See `nav-lg-row.spec.ts` for decisions D1/D2.
 */

const PAID_LG_ROW = ['Overview', 'Income', 'Expenses', 'Savings', 'Balances', 'Retirement', 'More']
const PREMIUM = ['Forecasting', 'Profiles', 'Report', 'Categories']

test.describe('paid desktop row at lg and up (AC-1)', () => {
  for (const width of [1024, 1280, 1920] as const) {
    test(`at ${width}px the paid row is six anchors plus More, whose panel is the premium four`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      expect(await rowLabels(page), `the paid row at ${width}px`).toEqual(PAID_LG_ROW)
      await openMore(page)
      expect(await panelLabels(page), 'the paid panel at lg').toEqual(PREMIUM)
      // Role-based and visibility-aware: exactly the four premium rows are
      // reachable in the open panel, not six.
      const visibleRows = page.locator(MORE_PANEL).getByRole('link')
      await expect(visibleRows).toHaveCount(4)
      for (const name of ['Balances', 'Retirement']) {
        await expect(
          page.locator(NAV).getByRole('link', { name, exact: true }),
          `${name} is not ONE visible link at ${width}px`
        ).toHaveCount(1)
      }
    })
  }

  for (const path of ['/balance', '/retirement'] as const) {
    test(`on ${path} at 1280px the row anchor is current and More is NOT`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const label = path === '/balance' ? 'Balances' : 'Retirement'
      await expect(
        page.locator(NAV).getByRole('link', { name: label, exact: true })
      ).toHaveAttribute('aria-current', 'page')
      expect(await moreBackground(page), `More claims ${path} at lg`).not.toBe(ACTIVE_BG)
    })
  }

  // The reference for the free spec's hover RECORD: the UNPREFIXED active
  // treatment (a premium route) under hover. A record, not a proof; see there.
  test('hover on the active More on a premium route gives the hover colour', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 800 })
    await page.goto('/forecasting')
    await page.waitForLoadState('networkidle')
    expect(await moreBackground(page)).toBe(ACTIVE_BG)
    await page.locator(MORE_SUMMARY).hover()
    const read = () =>
      page.locator(MORE_SUMMARY).evaluate((el) => getComputedStyle(el).backgroundColor)
    await expect.poll(read).toBe(HOVER_BG)
    // eslint-disable-next-line no-console -- the measurement is recorded
    console.log('[69.3 hover] paid /forecasting 800px:', await read())
  })

  test('More is still active on a premium route at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/forecasting')
    await page.waitForLoadState('networkidle')
    expect(await moreBackground(page)).toBe(ACTIVE_BG)
  })
})

test.describe('640-1023px is unchanged, paid (AC-2)', () => {
  for (const width of [640, 800, 1023] as const) {
    test(`at ${width}px the paid row is the five-item row with a six-row panel`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      expect(await rowLabels(page)).toEqual(['Overview', 'Income', 'Expenses', 'Savings', 'More'])
      await openMore(page)
      expect(await panelLabels(page)).toEqual(['Balances', 'Retirement', ...PREMIUM])
    })
  }

  for (const path of ['/balance', '/retirement'] as const) {
    test(`More is active on ${path} across the band`, async ({ page }) => {
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
