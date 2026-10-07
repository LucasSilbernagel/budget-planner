/**
 * counter.dev analytics wiring (story 10-1, AC-1 / AC-2 / AC-4 / FR28).
 *
 * counter.dev is a cookieless, open-source (AGPL) analytics service. Its
 * `script.js` reads its site id **exclusively** from
 * `document.currentScript.getAttribute('data-id')`, synchronously at the top of
 * the script. `document.currentScript` is set while any CLASSIC script runs and
 * is null for a module script (or inside a callback). The tag is wired through
 * the TanStack Start document head (`head().scripts` in `routes/__root.tsx`),
 * which `<Scripts />` renders as a real server-rendered `<script>`, so the id is
 * in the HTML the browser parses.
 *
 * `defer` (story 117.1, FR185): without it the tag was render-blocking (the
 * browser stopped parsing to fetch a third-party script before first paint).
 * A deferred script is still a classic, parser-inserted script, so
 * `currentScript` is still set when it runs. MEASURED 2026-10-07 in a real
 * browser (story 117.1 evidence): with `defer` the `/trackpage` beacon carries
 * the configured id; the same tag as `type="module"` throws on the null
 * `currentScript` and sends nothing. A classic tag added with
 * `createElement`/`appendChild` ALSO had `currentScript` set and sent the id in
 * that run: an earlier version of this comment said it would not. The SSR tag
 * is kept anyway, because it needs no client code and is in the first HTML.
 * ⚠️ Never `type="module"`; `async` would also keep the id but lets React 19
 * treat the tag as a hoistable resource, a bigger change than one attribute.
 *
 * The site id is a *public* identifier (it ships in client HTML by design, like
 * the Formspark form id), so exposing it to the bundle is intentional
 * and not a secret leak (NFR7). It is read at call time (not module scope) so
 * tests can stub it via `vi.stubEnv`, and trimmed so a stray-whitespace `.env`
 * value degrades to "no analytics" rather than emitting `data-id=" "`. When
 * unset (local dev / before the counter.dev account exists) no script is
 * emitted and the app degrades gracefully.
 *
 * counter.dev is cookieless (it uses localStorage/sessionStorage markers, never
 * cookies) and transmits only visitor metadata — referrer, screen dimensions,
 * the site id, UTC offset, and the page pathname. No financial or personally
 * identifying data is passed to it (AC-2). See ADR-005 for the recorded
 * data-sovereignty decision.
 */

/** The counter.dev analytics script URL (cookieless, AGPL). */
export const COUNTERDEV_SCRIPT_SRC = 'https://cdn.counter.dev/script.js'

/** A TanStack Start `head().scripts` entry for the counter.dev analytics tag. */
export interface AnalyticsScript {
  src: string
  'data-id': string
  /** Story 117.1: not render-blocking; keeps `document.currentScript` (see above). */
  defer: true
}

/**
 * The counter.dev site id, read at call time and trimmed. Empty when unset so
 * the integration degrades to "no analytics" rather than emitting a broken tag.
 */
function getCounterDevId(): string {
  return (import.meta.env.VITE_COUNTERDEV_ID ?? '').trim()
}

/**
 * Build the `head().scripts` entries for analytics. Returns a single
 * server-rendered counter.dev `<script src data-id defer>` when the site id is
 * configured, or `[]` (nothing emitted) when it is unset/whitespace-only.
 */
export function buildAnalyticsScripts(): AnalyticsScript[] {
  const id = getCounterDevId()
  return id ? [{ src: COUNTERDEV_SCRIPT_SRC, 'data-id': id, defer: true }] : []
}
