/**
 * counter.dev analytics wiring (story 10-1, AC-1 / AC-2 / AC-4 / FR28).
 *
 * counter.dev is a cookieless, open-source (AGPL) analytics service. Its
 * `script.js` reads its site id **exclusively** from
 * `document.currentScript.getAttribute('data-id')`, which is only populated for
 * a *parser-inserted* `<script>` tag. It is therefore wired through the TanStack
 * Start document head (`head().scripts` in `routes/__root.tsx`), which the
 * already-mounted `<Scripts />` renders as a real server-rendered `<script>` —
 * NOT via `document.createElement`/`appendChild` (which would leave
 * `document.currentScript === null` and the `data-id` unread → silent no-op).
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
 * server-rendered counter.dev `<script src data-id>` when the site id is
 * configured, or `[]` (nothing emitted) when it is unset/whitespace-only.
 */
export function buildAnalyticsScripts(): AnalyticsScript[] {
  const id = getCounterDevId()
  return id ? [{ src: COUNTERDEV_SCRIPT_SRC, 'data-id': id }] : []
}
