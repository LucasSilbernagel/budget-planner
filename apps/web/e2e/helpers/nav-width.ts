/**
 * The nav row's intrinsic-width harness — the ONE implementation.
 *
 * Committed by story 59.1's code review. Before that, every width figure in the
 * repo came from a throwaway script that was deleted after recording, so each
 * story rebuilt the method from prose and 59.1 rebuilt it WRONG three times (see
 * the trap below). `nav-tier-aware.paid.spec.ts` and `nav-responsive-css.spec.ts`
 * both quote figures from this; a future story re-measuring the row should call
 * it too rather than hand-rolling another version.
 *
 * ## ⚠️⚠️ RE-SCOPED BY STORY 59.2 — what it measures now
 *
 * Until 59.2 the desktop row was every `<a>` in the nav, because `sm:contents`
 * dissolved the More panel into it. Since 59.2 the row is FIVE flex items:
 * the outer `<li>` of Overview, Income, Expenses and Savings, and the More cell
 * (`<li><details><summary/>…`). The panel is an absolutely-positioned overlay
 * and is NOT in the row. The old helpers summed every `nav a`, so they would
 * have added the hidden panel anchors, left out the `<summary>`, and swapped the
 * `/balance` label, which is no longer in the row. The numbers would have been
 * meaningless and every count assertion green. So everything here reads the
 * ROW ITEMS (`${NAV} > ul > li`), and the panel is measured separately, open.
 *
 * ## ⚠️⚠️ THE TRAP — read before changing anything here
 *
 * **The flex ITEMS are the `<li>`, not the `<a>`.** 58.1's docblock prescribed
 * "`flex-shrink: 0` on every anchor"; applied literally to `nav a`, the `<li>`
 * wrappers stay shrinkable, so a TWO-WORD label WRAPS and the measurement returns
 * the width of its longest word. Measured under that bug: "Balance Tracking" read
 * 58.3px — NARROWER than "Balances" at 63.14px — i.e. the harness reported that
 * shortening a label made the row WIDER, reproducibly, with zero drift across an
 * A/B/A cycle. **A stable, repeatable number is not a correct one.**
 *
 * And the older form of the same trap: `flex-wrap: nowrap` ALONE is not enough.
 * The header is capped at `sm:max-w-6xl`, so with shrink still live the items
 * just compress and you read back roughly the container's own width (58.1's first
 * pass got 990px, ~93px below the truth).
 *
 * So: kill shrink on the `li`, pin `white-space: nowrap` on the label, lift the
 * cap, and measure far wider than it.
 *
 * ## Validating a change to this file (story 59.2)
 *
 * The pre-59.2 check (reproduce 58.1's paid 1082.23px) cannot be run any more:
 * the anchors it summed are not a row. The harness validates ITSELF instead,
 * against two probes that do not share its arithmetic. Both are returned by
 * `measureIntrinsic`/`measureWithLabel` and asserted by the measure specs.
 *
 *  1. **Sum vs render.** The summed item widths + gaps + padding must equal the
 *     list's own rendered width (`list.getBoundingClientRect().width`, cap
 *     lifted). The nav is not `flex-1`, so the list sizes to its content. A sum
 *     over the wrong elements (hidden anchors, a missing `<summary>`) cannot
 *     agree with it.
 *  2. **A/B vs font.** The saving from swapping one ROW label must equal the
 *     difference between the two strings in the nav's own font (`probeFont`).
 *     This is the same cross-check that validated 59.1: 118.58 − 63.14 = 55.44
 *     against a whole-row 55.43.
 *
 * ## CI fonts
 *
 * CI resolves `system-ui` to DejaVu Sans, dev boxes to the narrower Noto Sans, so
 * a locally-measured width is not CI's width. Run under `FONTCONFIG_FILE` and
 * check `fontProbe.family`/widths in the output to confirm the override actually
 * reached Chromium — a silently-ignored override is indistinguishable from a
 * working one. See the project's CI-font-width record.
 */
import type { Page } from '@playwright/test'

export const NAV = 'nav[aria-label="Primary"]'

/** The row's flex items: the four primary `<li>` and the More cell. */
const ROW_ITEMS = `${NAV} > ul > li`
/** A row item's label, whether the item is a link or the More `<summary>`. */
const ITEM_LABEL = ':scope > a [data-nav-label], :scope > details > summary [data-nav-label]'

export type IntrinsicMeasurement = {
  itemCount: number
  labels: string[]
  itemSum: number
  gapTotal: number
  listPadding: number
  /** items + gaps, EXCLUDING the list's own horizontal padding. */
  contentNeeded: number
  /**
   * items + gaps + the list's horizontal padding (read from computed style:
   * 32px of `px-4` until story 69.1, 16px of `pl-4` since) — the figure to
   * compare against `available`.
   */
  totalNeeded: number
  /** Independent probe 1: the list's own rendered width, cap lifted. Must equal `totalNeeded`. */
  renderedListWidth: number
}

/** Widths of strings in the nav's own font, as an independent cross-check. */
export async function probeFont(page: Page, samples: readonly string[]) {
  return page.evaluate((strings) => {
    const probe = document.createElement('span')
    probe.style.cssText =
      'position:absolute;visibility:hidden;white-space:nowrap;font:500 14px system-ui'
    document.body.append(probe)
    const widths: Record<string, number> = {}
    for (const s of strings) {
      probe.textContent = s
      widths[s] = Math.round(probe.getBoundingClientRect().width * 100) / 100
    }
    const family = getComputedStyle(probe).fontFamily
    probe.remove()
    return { family, widths }
  }, samples)
}

/**
 * What the row actually gets, cap IN PLACE. Call BEFORE `liftConstraints`.
 *
 * ⚠️ Since story 59.2 the list's `clientWidth` is NOT "available". The list is
 * no longer width-saturated: it sizes to its five items, and the header's
 * `justify-between` puts the slack BETWEEN the nav and the account cluster. So
 * three figures are recorded and named for what they are:
 *
 *  - `headerInner`: the `sm:max-w-6xl` row the nav shares with `AuthIndicator`.
 *  - `accountCluster`: the width `AuthIndicator` takes in that row.
 *  - `available`: `headerInner − accountCluster`, i.e. the most the nav could
 *    grow to before the two collide. This is the figure to compare
 *    `totalNeeded` against. 58.1's "973" and 59.1's "966" were the list's
 *    `clientWidth` while it was SATURATED, which equals this quantity only while
 *    the row overflows. That is why the two disagreed by 7px only at >= 1152px:
 *    the account cluster had changed width between the two measurements.
 *
 * `rows` counts distinct `top` values of the ROW ITEMS, never of `nav a`.
 * `emailWidth` is the email's VISIBLE box and `emailTextWidth` its full text
 * (they differ when `truncate` engages), or null when signed out. It is recorded
 * for story 59.3. The e2e servers have no real session, so a signed-in cluster
 * needs `/api/auth/me` mocked (see `nav-more-disclosure.paid.spec.ts`).
 *
 * ⚠️ Assumes the header row holds exactly TWO children, the nav and the
 * account cluster, and throws otherwise. A logo or a third item would silently
 * become "the cluster".
 */
export async function measureAvailable(page: Page, widths: readonly number[]) {
  const out: Record<
    number,
    {
      listClientWidth: number
      headerInner: number
      accountCluster: number
      available: number
      rows: number
      emailWidth: number | null
      emailTextWidth: number | null
    }
  > = {}
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(120)
    out[width] = await page.evaluate(
      ([nav, items]) => {
        const navEl = document.querySelector(nav) as HTMLElement
        const list = navEl.querySelector(':scope > ul') as HTMLElement
        const header = navEl.parentElement as HTMLElement
        if (header.children.length !== 2) {
          throw new Error(
            `the header row has ${header.children.length} children, not 2 (nav + account cluster) — "available" would be measured against the wrong element`
          )
        }
        const cluster = [...header.children].find((c) => c !== navEl) as HTMLElement
        const r = (n: number) => Math.round(n * 100) / 100
        const headerInner = r(header.clientWidth)
        const accountCluster = r(cluster.getBoundingClientRect().width)
        // The email is the only text in the cluster containing "@".
        let emailWidth: number | null = null
        let emailTextWidth: number | null = null
        const walker = document.createTreeWalker(cluster, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.textContent?.includes('@')) {
            const box = n.parentElement as HTMLElement
            emailWidth = r(box.getBoundingClientRect().width)
            emailTextWidth = r(box.scrollWidth)
            break
          }
        }
        return {
          listClientWidth: list.clientWidth,
          headerInner,
          accountCluster,
          available: r(headerInner - accountCluster),
          rows: new Set(
            [...document.querySelectorAll(items)].map((li) =>
              Math.round(li.getBoundingClientRect().top)
            )
          ).size,
          emailWidth,
          emailTextWidth,
        }
      },
      [NAV, ROW_ITEMS] as const
    )
  }
  return out
}

/** Lift every constraint that would compress the row. See THE TRAP above. */
export async function liftConstraints(page: Page) {
  await page.addStyleTag({
    content: `
      header, header * { max-width: none !important; }
      ${NAV} > ul { flex-wrap: nowrap !important; }
      ${NAV} li, ${NAV} a, ${NAV} summary { flex-shrink: 0 !important; }
      ${NAV} [data-nav-label] { white-space: nowrap !important; }
    `,
  })
  await page.waitForTimeout(250)
}

/** Intrinsic width of the ROW at the current viewport. Requires `liftConstraints` first. */
export function measureIntrinsic(page: Page): Promise<IntrinsicMeasurement> {
  return page.evaluate(
    ([nav, items, itemLabel]) => {
      const list = document.querySelector(`${nav} > ul`) as HTMLElement
      const cs = getComputedStyle(list)
      const listPadding = Number.parseFloat(cs.paddingLeft) + Number.parseFloat(cs.paddingRight)
      const gap = Number.parseFloat(cs.columnGap || '0')
      const lis = [...document.querySelectorAll(items)] as HTMLElement[]
      const itemSum = lis.reduce((t, li) => t + li.getBoundingClientRect().width, 0)
      const gapTotal = gap * (lis.length - 1)
      const r = (n: number) => Math.round(n * 100) / 100
      return {
        itemCount: lis.length,
        labels: lis.map((li) => (li.querySelector(itemLabel)?.textContent ?? '').trim()),
        itemSum: r(itemSum),
        gapTotal: r(gapTotal),
        listPadding,
        contentNeeded: r(itemSum + gapTotal),
        totalNeeded: r(itemSum + gapTotal + listPadding),
        renderedListWidth: r(list.getBoundingClientRect().width),
      }
    },
    [NAV, ROW_ITEMS, ITEM_LABEL] as const
  )
}

/**
 * Measure the row with one ROW item's label swapped, then restore it — an A/B in
 * ONE page session, so the two arms cannot differ in viewport, fonts, tier or
 * hydration. `href` names a primary tab (`/expenses`), or `'more'` for the
 * trigger. Throws if the label is not a row item, because swapping a label
 * that is not in the row measures nothing (the pre-59.2 `/balance` trap).
 */
export async function measureWithLabel(page: Page, href: string, label: string) {
  const swap = (target: string, text: string) =>
    page.evaluate(
      ([nav, h, t]) => {
        const span = (
          h === 'more'
            ? document.querySelector(`${nav} > ul > li > details > summary [data-nav-label]`)
            : document.querySelector(`${nav} > ul > li > a[href="${h}"] [data-nav-label]`)
        ) as HTMLElement | null
        if (!span) throw new Error(`"${h}" is not a ROW item of ${nav} — nothing to measure`)
        const previous = span.textContent ?? ''
        span.textContent = t
        void (document.querySelector(`${nav} > ul`) as HTMLElement).offsetWidth
        return previous
      },
      [NAV, target, text] as const
    )
  const restore = await swap(href, label)
  const measurement = await measureIntrinsic(page)
  await swap(href, restore)
  return measurement
}

/**
 * The open panel's own box. The panel is an overlay, so it is measured
 * separately from the row, and open, because a closed `<details>` hides its
 * content (`checkVisibility()` is false). Cap IN PLACE: this is a real-layout
 * reading. Opens the panel through the trigger and closes it again afterwards.
 */
export async function measurePanel(page: Page) {
  const summary = page.locator(`${NAV} > ul > li > details > summary`)
  const isOpen = () =>
    page.evaluate(
      (nav) => (document.querySelector(`${nav} > ul > li > details`) as HTMLDetailsElement).open,
      NAV
    )
  // Poll, never sleep, and refuse to measure or return in the wrong state: a
  // panel left open poisons every later measurement in the session (see the
  // restore-before-returning note in this file's history).
  const waitFor = async (want: boolean) => {
    for (let i = 0; i < 50 && (await isOpen()) !== want; i++) await page.waitForTimeout(20)
    if ((await isOpen()) !== want)
      throw new Error(`the More panel did not ${want ? 'open' : 'close'}`)
  }
  if (await isOpen()) throw new Error('measurePanel called with the panel already open')
  await summary.click()
  await waitFor(true)
  const m = await page.evaluate((nav) => {
    const panel = document.querySelector(`${nav} > ul > li > details > ul`) as HTMLElement
    const b = panel.getBoundingClientRect()
    const r = (n: number) => Math.round(n * 100) / 100
    const rows = [...panel.querySelectorAll(':scope > li > a')] as HTMLElement[]
    return {
      visible: panel.checkVisibility(),
      width: r(b.width),
      height: r(b.height),
      left: r(b.left),
      top: r(b.top),
      rowHeights: rows.map((a) => r(a.getBoundingClientRect().height)),
      widestRowLabel: r(
        Math.max(
          ...rows.map(
            (a) =>
              (a.querySelector('[data-nav-label]') as HTMLElement).getBoundingClientRect().width
          )
        )
      ),
      overflowX: panel.scrollWidth - panel.clientWidth,
    }
  }, NAV)
  await summary.click()
  await waitFor(false)
  return m
}

/**
 * Every DESKTOP viewport in `[from, to]` (step `step`) at which the row is NOT a
 * single line. Empty means one row across the whole range. Cap IN PLACE: this
 * is a real-layout question, so do NOT call `liftConstraints`.
 *
 * ⚠️ Story 59.2's code review replaced `findSingleRowThreshold`, which returned
 * the FIRST one-row width. The measure specs read `threshold === 640` as "one
 * row at every desktop width", but nothing above the first hit was ever
 * inspected. A layout that is one row at 640px and re-wraps wider would have
 * passed. This checks every step.
 */
export async function findWrappingWidths(
  page: Page,
  { from = 640, to = 1400, step = 5 }: { from?: number; to?: number; step?: number } = {}
) {
  const wrapping: number[] = []
  for (let width = from; width <= to; width += step) {
    await page.setViewportSize({ width, height: 900 })
    const rows = await page.evaluate(
      (items) =>
        new Set(
          [...document.querySelectorAll(items)].map((li) =>
            Math.round(li.getBoundingClientRect().top)
          )
        ).size,
      ROW_ITEMS
    )
    if (rows !== 1) wrapping.push(width)
  }
  return wrapping
}
