import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The profile card IS the switcher (story 63.1, FR96) — target size and real
 * independent operability, in a real browser.
 *
 * ⚠️ `.paid.spec.ts` is load-bearing: only the `chromium-paid` project (:5174,
 * booted with an entitled `E2E_SESSION_SEED`) runs this file. `/profiles` is a
 * premium route, so on the free server this spec would only ever see the locked
 * upgrade prompt and every assertion below would be measuring the wrong page.
 * Rename it and it stops testing anything. See `playwright.config.ts:32-38`.
 *
 * ⚠️ With `PLAYWRIGHT_BASE_URL` set, the `chromium-paid` project is DROPPED, not
 * redirected (`playwright.config.ts:38-39`) — a "green" run under that env var
 * has not run this file at all. Check the reported test count, not the exit code.
 *
 * ## What only this layer can prove
 *
 * AC-6 is a TARGET SIZE requirement (SC 2.5.8) at 320px. jsdom compiles no
 * Tailwind, so `getComputedStyle` there cannot fail and a class-token assertion
 * proves only that a class is present, never that it renders a box of any size.
 * Real bounding boxes exist only here.
 *
 * ⚠️ MEASURED AT CONTEXT TIME, and worth not re-deriving: `/profiles` renders its
 * management UI on this server with cards seeded purely from localStorage. It is
 * NOT blocked the way `/forecasting` is — `getProfiles` (which throws
 * `ReferenceError: Buffer is not defined` here, because Vite bundles the `pg`
 * driver into the dev client) has exactly ONE caller in `apps/web/src`, and it is
 * `routes/forecasting.tsx`. `ProfilesPage` never calls it: it gates on
 * `usePremiumAccess`, and the cards come from the persisted `profileStore`.
 *
 * ⚠️ The seed works because `addInitScript` runs before any page script, so the
 * key is already in localStorage when the store reads it. That is true of any
 * persisted store and has nothing to do with `skipHydration`.
 *
 * ⚠️ An earlier version of this comment said the seed took effect *because*
 * `profileStore` uses `skipHydration: true`. That was backwards and the code
 * review caught it: `skipHydration` is why the app must call `rehydrate()`
 * itself (see `lib/store-hydration.tsx`), not why an init script lands in time.
 * The seed would work identically under auto-hydration.
 */

const MAIN = 'seed-main'
const BIZ = 'seed-biz'

async function seedProfiles(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const now = '2026-09-23T00:00:00.000Z'
    localStorage.setItem(
      'budget-planner-profiles-v1',
      JSON.stringify({
        state: {
          profiles: [
            {
              id: 'seed-main',
              userId: 'e2e-paid-user',
              name: 'Main Profile',
              description: 'Everyday money',
              isDefault: true,
              currency: 'NONE',
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 'seed-biz',
              userId: 'e2e-paid-user',
              name: 'Business',
              description: 'Consulting',
              isDefault: false,
              currency: 'EUR',
              createdAt: now,
              updatedAt: now,
            },
          ],
          activeProfileId: 'seed-main',
        },
        version: 1,
      })
    )
  })
}

async function gotoProfiles(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 })
  await seedProfiles(page)
  await page.goto('/profiles')
  await page.waitForLoadState('networkidle')
  // Positive control for every assertion in this file: we are on the MANAGEMENT
  // UI, not the locked upgrade surface and not the loading spinner. Without this
  // a card locator that matches nothing would read as a passing absence.
  await expect(page.getByRole('button', { name: '+ New Profile' })).toBeVisible()
}

/** The card element, located from its own activation region. */
function card(page: Page, name: string) {
  return page.getByRole('button', { name: `Switch to ${name}` })
}

for (const width of [320, 1280] as const) {
  test(`the activation region and both row actions meet the 28px target floor at ${width}px`, async ({
    page,
  }) => {
    await gotoProfiles(page, width)

    // The NON-active card carries all three controls at once.
    const bizCard = page
      .locator('div.surface')
      .filter({ has: page.getByRole('button', { name: 'Switch to Business' }) })

    // ⚠️ The EFFECTIVE activation target is the CARD, not the name button's own
    // box. Since the code review restructure the button is just the name text
    // (~20px tall) and its `::after` overlay is what a user actually taps, and an
    // overlay contributes nothing to `boundingBox()`. Asserting the button's own
    // height here would fail while the real target is card-sized — measuring the
    // wrong box and calling it a target-size regression. The hit test at the
    // bottom of this test is what proves the overlay really covers the card.
    const target = await bizCard.boundingBox()
    expect(target?.height ?? 0, 'card activation target height').toBeGreaterThanOrEqual(28)

    const edit = await bizCard.getByRole('button', { name: 'Edit Business' }).boundingBox()
    expect(edit?.height ?? 0, 'Edit height').toBeGreaterThanOrEqual(28)
    expect(edit?.width ?? 0, 'Edit width').toBeGreaterThanOrEqual(28)

    const del = await bizCard.getByRole('button', { name: 'Delete Business' }).boundingBox()
    expect(del?.height ?? 0, 'Delete height').toBeGreaterThanOrEqual(28)
    expect(del?.width ?? 0, 'Delete width').toBeGreaterThanOrEqual(28)

    // ⚠️⚠️ HIT TESTING, not geometry (code review). This card uses a STRETCHED
    // LINK: the name button carries an `::after` overlay covering the whole card,
    // so the activation area OVERLAPS the action row by design and z-order is what
    // keeps Edit and Delete clickable. A non-overlap assertion would therefore be
    // wrong here — and worse, it would have passed on the pre-review layout while
    // saying nothing about what a tap actually lands on.
    //
    // `elementFromPoint` answers the real question: at this pixel, who gets the
    // click? That catches a missing `relative z-10` on the actions row, which is
    // the one regression that would silently turn every Edit click into a switch.
    if (!edit || !del) throw new Error('missing box')
    const hitAt = (x: number, y: number) =>
      page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px as number, py as number)
          const actionable = el?.closest('button')
          return actionable?.getAttribute('aria-label') ?? actionable?.textContent?.trim() ?? null
        },
        [x, y]
      )

    expect(await hitAt(edit.x + edit.width / 2, edit.y + edit.height / 2)).toBe('Edit Business')
    expect(await hitAt(del.x + del.width / 2, del.y + del.height / 2)).toBe('Delete Business')

    // And the card BODY — the empty space that is not any of the three controls —
    // still reaches the switcher, which is what "the whole card, not a button on
    // it" (FR96) means for a pointer.
    const cardBox = await bizCard.boundingBox()
    if (!cardBox) throw new Error('missing card box')
    expect(await hitAt(cardBox.x + cardBox.width - 12, cardBox.y + 12)).toBe('Switch to Business')
  })
}

test('clicking a card switches to that profile, in a real browser', async ({ page }) => {
  await gotoProfiles(page, 320)

  // Seeded active profile is Main.
  await expect(page.getByRole('button', { name: 'Main Profile (current profile)' })).toBeVisible()

  await card(page, 'Business').click()

  // The active treatment MOVED. Asserting only that Business became current
  // would leave a two-actives bug green, so Main's loss is asserted too.
  await expect(page.getByRole('button', { name: 'Business (current profile)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Switch to Main Profile' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Main Profile (current profile)' })).toHaveCount(0)

  // And it PERSISTED — the store write is the real one, not component state.
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('budget-planner-profiles-v1') ?? '{}')
  )
  expect(persisted?.state?.activeProfileId).toBe(BIZ)
})

test('Edit opens without also switching, at 320px', async ({ page }) => {
  await gotoProfiles(page, 320)

  const bizCard = page
    .locator('div.surface')
    .filter({ has: page.getByRole('button', { name: 'Switch to Business' }) })
  await bizCard.getByRole('button', { name: 'Edit Business' }).click()

  // Positive control: the click really landed on Edit.
  await expect(page.getByRole('dialog', { name: 'Edit Profile' })).toBeVisible()
  // ...and it did not drag a switch along with it.
  await expect(page.getByRole('button', { name: 'Main Profile (current profile)' })).toBeVisible()
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('budget-planner-profiles-v1') ?? '{}')
  )
  expect(persisted?.state?.activeProfileId).toBe(MAIN)
})

test('the switcher dropdown is gone from the page header', async ({ page }) => {
  await gotoProfiles(page, 1280)

  // The deleted control's trigger carried `aria-haspopup` and the menu header
  // read "Switch Profile".
  //
  // ⚠️ SCOPED to the page header, not the whole document (code review). A
  // page-wide `[aria-haspopup]` count of 0 pins an unrelated global invariant:
  // any future legitimate popup control anywhere on /profiles — a combobox in
  // the Edit dialog, say — would fail a test whose name claims only that the
  // header dropdown is gone. The dropdown lived in the header, so that is where
  // its absence belongs.
  //
  // ⚠️ The header is located BY ITS CONTENT and positively controlled below. A
  // structural selector that silently matched nothing would make the absence
  // assertion pass for the wrong reason.
  const header = page
    .locator('div')
    .filter({ has: page.getByRole('heading', { level: 1, name: 'Profiles' }) })
    .filter({ has: page.getByRole('button', { name: '+ New Profile' }) })
    .last()
  await expect(header.getByRole('button', { name: '+ New Profile' })).toBeVisible()
  await expect(header.locator('[aria-haspopup]')).toHaveCount(0)
  await expect(page.getByText('Switch Profile', { exact: true })).toHaveCount(0)

  // Positive control: the header itself still rendered, so the two absences
  // above are absences ON A REAL PAGE, not the silence of a page that failed.
  await expect(page.getByRole('heading', { level: 1, name: 'Profiles' })).toBeVisible()
})
