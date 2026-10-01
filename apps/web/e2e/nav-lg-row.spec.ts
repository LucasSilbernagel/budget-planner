import { expect, test } from '@playwright/test'
import { MORE_PANEL, NAV, isMoreOpen, openMore } from './helpers/nav-more'

test.describe('free desktop row at lg and up (AC-1)', () => {
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
