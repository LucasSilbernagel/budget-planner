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
 * semantic tokens (`surface-inset` / `text-body` / `text-muted`) so it stays
 * legible in dark mode, and it wraps rather than overflowing at 320px.
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
    <div data-account-notice className="surface-inset mt-4 rounded-lg p-3 text-sm">
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
            this app has no hover-surface token; both combinations were measured
            for SC 1.4.11 — gray-700 on gray-100 and gray-200 on gray-700 are
            both far above 3:1, and the resting glyph is 4.8:1 light / ~6.4:1
            dark against `surface-inset`. */}
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
