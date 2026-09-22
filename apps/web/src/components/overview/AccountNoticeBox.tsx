import { useCallback, useEffect, useState } from 'react'
import {
  markAccountNoticeDismissedOnDocument,
  rememberAccountNoticeDismissal,
  wasAccountNoticeDismissed,
} from '../../lib/overview/account-notice-dismissal'

/**
 * The Overview's privacy-positioning notice, now dismissable (story 55.1, FR82).
 *
 * Content is unchanged from story 27-5 / brand-1: the three privacy pillars and
 * the "intentional budgeting" framing. Every claim is true — the Free tier is
 * client-only (no account; data stays in the browser), the OPTIONAL Premium sync
 * is EU-hosted (DanubeData, Germany), the app has no bank/financial-institution
 * integration, and there is no AI/LLM dependency in any package manifest or
 * source tree. The no-AI claim lives on the FRAMING line only, never on the
 * pillars line — stating it twice inside a two-line block reads as padding
 * (brand-1 AC-6, pinned in `HomePage.test.tsx`). Styled with theme-aware
 * semantic tokens (`surface-inset` / `border-default` / `text-body` /
 * `text-muted`) so it stays legible in dark mode, and it wraps rather than
 * overflowing at 320px.
 *
 * ⚠️ THE BORDER IS THE ONLY THING MAKING THIS A BOX IN LIGHT MODE (story 60.1,
 * FR91), AND IT IS DELIBERATELY A `surface-inset` OUTLIER.
 * `surface-inset`'s own docblock (`styles/global.css:52-54`) defines it as "a
 * panel nested on a `.surface` card", and this is the one place it is applied to
 * the PAGE CANVAS instead. That canvas is `surface-sunken` (`HomePage.tsx:623`)
 * — and in light mode `surface-inset` and `surface-sunken` are the SAME colour,
 * `bg-gray-50`. Measured at `c44068a`, before this border existed: box
 * `rgb(249, 250, 251)` on canvas `rgb(249, 250, 251)`, with `border-width: 0px`
 * and `border-color: rgb(229, 231, 235)` on all four sides. There was no box,
 * only floating text.
 *
 * (`git grep surface-inset -- src` finds 64 non-test OCCURRENCES across 23
 * files, but ~13 of those are prose in comments; the real className call sites
 * elsewhere number about 50. Re-run the grep rather than trusting either
 * number.)
 *
 * The fix is the border, NOT the fill. Swapping to `surface` would also work and
 * would retire the outlier, but it would give a privacy footnote in the <header>
 * the same visual weight as the real content cards in <main>, and it would move
 * the DARK fill (`gray-700/40` -> `gray-800`) although dark mode was never
 * broken. Leaving the fill alone is what keeps the dark theme additive and what
 * lets the dismiss button's contrast pairs below be re-derived against an
 * unchanged background. Do NOT edit the `surface-inset` token to "fix" this; the
 * other call sites use it correctly.
 *
 * ⚠️ WHY A RAW `border-gray-300 dark:border-gray-700` PAIR AND NOT
 * `border-default`. `border-default` is `border-gray-200 dark:border-gray-700`,
 * and gray-200 on this gray-50 canvas measures only 1.18:1 — a hairline at that
 * ratio is close to the "~1.05:1 … imperceptible in practice" step a previous
 * review rejected outright at `styles/global.css:93-96`, and that review was
 * judging a FULL-AREA FILL, which is far more perceptible than a 1px line at the
 * same ratio. gray-300 measures 1.41:1 in light. The DARK half is byte-identical
 * to `border-default`'s, so dark mode is unchanged. Decision by Lucas,
 * 2026-09-22, during the story's code review. `routes/login.tsx` (:96, :128)
 * still uses `border-default` for its notice panels — correctly, because those
 * sit on a WHITE `.surface` card, not on this canvas.
 *
 * ⚠️ THE COLOUR CLASS AND THE WIDTH CLASS ARE BOTH REQUIRED. A Tailwind colour
 * utility sets no width, so `border-gray-300` alone renders nothing; the bare
 * `border` supplies the 1px. Note also that under **Tailwind 3** (this project
 * is on 3.4.19) preflight sets `border-color: theme('borderColor.DEFAULT')` =
 * gray-200 on EVERY element, which is why the `c44068a` measurement above shows
 * a border colour at zero width — and why, before this story picked gray-300, a
 * light-mode colour assertion could not tell `border-default` from preflight.
 * Tailwind 4's preflight uses `currentColor` instead, so re-measure on upgrade.
 * `e2e/overview-account-notice.spec.ts` measures both themes.
 *
 * ⚠️ THE TWO <p> TEXT NODES ARE PINNED BY AN SSR HTML SUBSTRING ASSERTION.
 * `e2e/loading-state.spec.ts`'s "SEO fence" asserts the server response
 * contains the literal `>No account needed · Optional sync is EU-hosted · No
 * bank connection.</p>` — closing tags, not bare phrases, because an earlier
 * version matched the `<meta name="description">` in the head while the body
 * copy was gone. Keep each sentence a single-line JSX text child of its own
 * `<p>`: reflowing it across lines or wrapping it in a `<span>` breaks that
 * fence. The surrounding flex wrappers are fine — they do not sit inside the
 * `<p>`s.
 *
 * ⚠️ DISMISSAL IS A TWO-LAYER FEATURE AND THIS IS ONLY THE SECOND LAYER.
 * The React read below runs in an effect, i.e. AFTER first paint, which is what
 * keeps the server render and the first client render identical (AC-3) — the
 * server cannot know a per-browser dismissal, so both must render the box
 * present. On its own that would paint the box and then remove it on every load
 * for a dismissed user, which is the flash AC-4 forbids. The first layer —
 * `lib/overview/no-flash-account-notice-script` plus the
 * `[data-dismiss-account-notice='1']` rule in `styles/global.css` — suppresses
 * it before first paint. Both halves are required; neither is redundant. That
 * is why the box carries `data-account-notice`: it is the CSS hook.
 *
 * Dismissal is PERMANENT and per-browser (AC-2, AC-6). It is localStorage only,
 * so it does not follow the user to another device even on the paid tier —
 * syncing it would need a new synced preference, which this story does not add.
 */
export function AccountNoticeBox() {
  /**
   * ⚠️ `useState(false)`, NEVER `useState(wasAccountNoticeDismissed())`.
   * A lazy initializer runs during render — including the first client render —
   * which would disagree with the server's always-present box and produce a
   * hydration mismatch. Pre-paint suppression is the stylesheet's job, not
   * React's.
   */
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (wasAccountNoticeDismissed()) {
      setDismissed(true)
    }
  }, [])

  /**
   * ⚠️ MARKING THE DOCUMENT IS NOT BELT-AND-BRACES — it closes a real flash
   * found in code review and reproduced in a real browser.
   *
   * The `<head>` bootstrap runs once per DOCUMENT load, so it cannot know about
   * a dismissal that happens later in the same document. Without the mark
   * below: dismiss on `/`, navigate to `/income`, navigate back — `HomePage`
   * remounts, `useState(false)` renders the box, and because TanStack commits
   * navigations inside `startTransition` the passive effect that would remove
   * it flushes AFTER paint. Measured with a MutationObserver: the node
   * re-attached with `display: "block"` while `<html>` carried no attribute.
   * That is the AC-4 flash, on every client-side return for the rest of the
   * document's life.
   *
   * Setting the attribute here hands the rest of the document lifetime to the
   * CSS rule, exactly as a fresh page load would. It is safe to set one-way
   * precisely because this dismissal has NO undo path (verified in review: no
   * `localStorage.clear()` and no writer of this key anywhere in
   * `apps/web/src`), so it cannot reproduce the stale-attribute bug the planner
   * rule in `styles/global.css` documents.
   */
  const dismiss = useCallback(() => {
    rememberAccountNoticeDismissal()
    markAccountNoticeDismissedOnDocument()
    setDismissed(true)
  }, [])

  if (dismissed) {
    return null
  }

  return (
    <div
      data-account-notice
      className="surface-inset mt-4 rounded-lg border border-gray-300 p-3 text-sm dark:border-gray-700"
    >
      {/* `min-w-0 flex-1` on the text column so the two sentences wrap instead
          of forcing the row wider than a 320px viewport (the constraint the
          story-27-5 copy has always carried). Mirrors
          `components/pwa/InstallPrompt`'s header row. */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body">
            No account needed · Optional sync is EU-hosted · No bank connection.
          </p>
          <p className="text-muted mt-1">
            Intentional budgeting without bank sync or AI integrations.
          </p>
        </div>
        {/* ⚠️ `min-h-7 min-w-7` (28px) is a WCAG 2.2 SC 2.5.8 floor, not
            styling. `p-1` around a 16px glyph computes to exactly 24px — the
            bare minimum, with nothing left if the root font shrinks. Story
            51.2's review found a desktop target-size defect that every gate
            passed, so the size is asserted in the e2e spec against a real
            bounding box, which is the only place it can actually be measured.
            The button is a flex centring box, so the glyph needs no fixed
            dimensions of its own — an 18px `text-lg` glyph in a hard `h-4 w-4`
            (16px) box with `leading-4` can clip or sit off-centre.

            ⚠️ The NAME IS CONTEXTFUL ON PURPOSE. A bare "Dismiss" announces
            nothing about what is being dismissed, and this app already has a
            second dismiss affordance (`components/pwa/InstallPrompt`, labelled
            "Dismiss install prompt"). It also matters for tests: Playwright's
            `getByRole` name option is a case-insensitive SUBSTRING match unless
            `exact: true`, so a bare "Dismiss" locator would match both buttons
            and trip strict mode the moment the install prompt renders.
            The glyph is `aria-hidden` so a screen reader never reads "times".

            Colour: `text-muted` is the semantic token (`text-gray-500
            dark:text-gray-400`), so the base state goes through the token
            system like the rest of the box. The hover pair stays raw because
            this app has no hover-surface token; the hover combinations
            gray-700-on-gray-100 and gray-200-on-gray-700 are both far above SC
            1.4.11's 3:1.

            Resting glyph against this box's fill, RECOMPUTED for story 60.1
            (WCAG relative luminance, 2026-09-22):
              light — gray-500 `#6b7280` on gray-50 `#f9fafb` = **4.63:1**
              dark  — gray-400 `#9ca3af` on the COMPOSITE of `gray-700/40` over
                      gray-900, i.e. rgb(32.2, 40.4, 55.8)      = **5.79:1**
            Both clear 3:1 and 4.5:1.

            ⚠️ These supersede the "4.8:1 light / ~6.4:1 dark" this comment
            carried from story 55.1, which were wrong for the stated background:
            4.83:1 is gray-500 on WHITE, not on gray-50, and the ~6.4 figure
            ignored the 40% overlay (gray-400 on BARE gray-900 is 6.99:1).
            Story 60.1's first draft asserted it had "re-checked" these while
            actually inheriting them — caught in that story's code review. The
            fill is unchanged by 60.1 (the border carries the fix), so these
            ratios are a property of the box as it stands; if the fill ever
            moves, recompute rather than re-affirming. */}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss privacy notice"
          className="text-muted -mr-1 -mt-1 flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-md hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            &times;
          </span>
        </button>
      </div>
    </div>
  )
}
