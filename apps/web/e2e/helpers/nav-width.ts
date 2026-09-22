/**
 * The nav row's intrinsic-width harness — the ONE implementation.
 *
 * Committed by story 59.1's code review. Before that, every width figure in the
 * repo came from a throwaway script that was deleted after recording, so each
 * story rebuilt the method from prose and 59.1 rebuilt it WRONG three times (see
 * the trap below). `nav-tier-aware.paid.spec.ts` and `nav-responsive-css.spec.ts`
 * both call this now; a future story re-measuring the row should call it too
 * rather than hand-rolling a fourth version.
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
 * The header is capped at `sm:max-w-6xl`, so with shrink still live the anchors
 * just compress and you read back roughly the container's own width (58.1's first
 * pass got 990px, ~93px below the truth).
 *
 * So: kill shrink on the `li`, pin `white-space: nowrap` on the label, lift the
 * cap, and measure far wider than it.
 *
 * ## Validating a change to this file
 *
 * `measureIntrinsic` must reproduce 58.1's independently-recorded paid totals:
 * **1082.23px DejaVu / 1036.75px Noto** with the `/balance` label set to
 * "Balance Tracking". If it does not, the harness is wrong, not the figures.
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

export type IntrinsicMeasurement = {
  anchorCount: number
  labels: (string | undefined)[]
  anchorSum: number
  gapTotal: number
  listPadding: number
  /** anchors + gaps, EXCLUDING the list's own `px-4`. */
  contentNeeded: number
  /** anchors + gaps + the list's 32px `px-4` — the figure to compare against `available`. */
  totalNeeded: number
}

/** Widths of two strings in the nav's own font, as an independent cross-check. */
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
 * `available` — what the row actually has, cap IN PLACE. Call BEFORE
 * `liftConstraints`. `rows` counts distinct anchor `top` values.
 */
export async function measureAvailable(page: Page, widths: readonly number[]) {
  const out: Record<number, { clientWidth: number; rows: number }> = {}
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(120)
    out[width] = await page.evaluate((nav) => {
      const list = document.querySelector(`${nav} > ul`) as HTMLElement
      return {
        clientWidth: list.clientWidth,
        rows: new Set(
          [...list.querySelectorAll('a')].map((a) => Math.round(a.getBoundingClientRect().top))
        ).size,
      }
    }, NAV)
  }
  return out
}

/** Lift every constraint that would compress the row. See THE TRAP above. */
export async function liftConstraints(page: Page) {
  await page.addStyleTag({
    content: `
      header, header * { max-width: none !important; }
      ${NAV} > ul { flex-wrap: nowrap !important; }
      ${NAV} li, ${NAV} a, ${NAV} button { flex-shrink: 0 !important; }
      ${NAV} [data-nav-label] { white-space: nowrap !important; }
    `,
  })
  await page.waitForTimeout(250)
}

/** Intrinsic width at the current viewport. Requires `liftConstraints` first. */
export function measureIntrinsic(page: Page): Promise<IntrinsicMeasurement> {
  return page.evaluate((nav) => {
    const list = document.querySelector(`${nav} > ul`) as HTMLElement
    const cs = getComputedStyle(list)
    const listPadding = Number.parseFloat(cs.paddingLeft) + Number.parseFloat(cs.paddingRight)
    const gap = Number.parseFloat(cs.columnGap || '0')
    const anchors = [...list.querySelectorAll('a')] as HTMLElement[]
    const anchorSum = anchors.reduce((t, a) => t + a.getBoundingClientRect().width, 0)
    const gapTotal = gap * (anchors.length - 1)
    const r = (n: number) => Math.round(n * 100) / 100
    return {
      anchorCount: anchors.length,
      labels: anchors.map((a) => a.textContent?.trim()),
      anchorSum: r(anchorSum),
      gapTotal: r(gapTotal),
      listPadding,
      contentNeeded: r(anchorSum + gapTotal),
      totalNeeded: r(anchorSum + gapTotal + listPadding),
    }
  }, NAV)
}

/**
 * Measure the row with one destination's label swapped, then restore it — an A/B
 * in ONE page session, so the two arms cannot differ in viewport, fonts, tier or
 * hydration. (Controlled, not metaphysically identical: the "before" arm is a
 * text-node swap on the post-change build, not the pre-change build. The check
 * that it is nonetheless right is the 58.1 reproduction noted above.)
 */
export async function measureWithLabel(page: Page, href: string, label: string) {
  const restore = await page.evaluate(
    ([nav, h, l]) => {
      const span = document.querySelector(
        `${nav} a[href="${h}"] [data-nav-label]`
      ) as HTMLElement | null
      if (!span) throw new Error(`no [data-nav-label] under ${nav} a[href="${h}"]`)
      const previous = span.textContent ?? ''
      span.textContent = l
      void (document.querySelector(`${nav} > ul`) as HTMLElement).offsetWidth
      return previous
    },
    [NAV, href, label] as const
  )
  const measurement = await measureIntrinsic(page)
  await page.evaluate(
    ([nav, h, prev]) => {
      const span = document.querySelector(`${nav} a[href="${h}"] [data-nav-label]`) as HTMLElement
      span.textContent = prev
    },
    [NAV, href, restore] as const
  )
  return measurement
}

/**
 * Narrowest viewport at which the row is a single line, or null if it never is.
 * Cap IN PLACE — this is a real-layout question, so do NOT call `liftConstraints`.
 *
 * Pass `label` + `href` to sweep with one destination's label swapped, which is
 * how you compare a rename's effect on the threshold without rebuilding the app.
 * The swap is a text-node write, so it would be undone by any React re-render;
 * the sweep re-asserts the label at the end and throws if it did not survive,
 * rather than returning a threshold measured against the wrong text.
 */
export async function findSingleRowThreshold(
  page: Page,
  {
    from = 640,
    to = 1400,
    href,
    label,
  }: { from?: number; to?: number; href?: string; label?: string } = {}
) {
  let original: string | null = null
  if (href && label) {
    original = await page.evaluate(
      ([nav, h, l]) => {
        const span = document.querySelector(`${nav} a[href="${h}"] [data-nav-label]`) as HTMLElement
        const previous = span.textContent
        span.textContent = l
        return previous
      },
      [NAV, href, label] as const
    )
  }

  let found: number | null = null
  for (let width = from; width <= to; width += 1) {
    await page.setViewportSize({ width, height: 900 })
    const rows = await page.evaluate((nav) => {
      const list = document.querySelector(`${nav} > ul`) as HTMLElement
      return new Set(
        [...list.querySelectorAll('a')].map((a) => Math.round(a.getBoundingClientRect().top))
      ).size
    }, NAV)
    if (rows === 1) {
      found = width
      break
    }
  }

  if (href && label) {
    const survived = await page.evaluate(
      ([nav, h]) => {
        const span = document.querySelector(`${nav} a[href="${h}"] [data-nav-label]`) as HTMLElement
        return span.textContent
      },
      [NAV, href] as const
    )
    // ⚠️ RESTORE BEFORE THROWING/RETURNING. Leaving the swap in place silently
    // poisons every later measurement in the same page session — the first
    // version of this helper did exactly that, and both arms of the A/B came
    // back byte-identical (a "saving" of 0) until the harness-correctness guard
    // in the calling spec caught it.
    await page.evaluate(
      ([nav, h, prev]) => {
        const span = document.querySelector(`${nav} a[href="${h}"] [data-nav-label]`) as HTMLElement
        span.textContent = prev
      },
      [NAV, href, original ?? ''] as const
    )
    if (survived !== label) {
      throw new Error(
        `label swap did not survive the sweep (expected "${label}", found "${survived}") — the threshold would be measured against the wrong text`
      )
    }
  }
  return found
}
