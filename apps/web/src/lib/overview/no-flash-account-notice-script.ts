import {
  ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE,
  ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY,
  DISMISSED_VALUE,
} from './account-notice-dismissal'

/**
 * No-flash bootstrap for the Overview "No account needed" notice
 * (story 55.1, AC-4). Runs synchronously in <head> before first paint: reads
 * the dismissal flag and marks <html> with `data-dismiss-account-notice="1"`
 * so the rule in `styles/global.css` suppresses the box on the very first
 * frame — no flash of a box the user closed.
 *
 * ⚠️ WHY THIS IS NECESSARY AND NOT BELT-AND-BRACES. The story's own AC-3
 * requires the React-side read to happen inside an effect, so that the server
 * render and the first client render agree (the server cannot know a
 * per-browser dismissal, so both must render the box PRESENT). Effects run
 * AFTER first paint. That means applying the dismissal "once React has
 * mounted" is precisely what produces the flash AC-4 forbids: the box paints,
 * then vanishes, on every single page load for a user who dismissed it — which
 * is the annoyance this story exists to remove. Only a synchronous <head>
 * script beats first paint. `lib/nav/no-flash-planner-visibility-script` and
 * `components/theme/ThemeProvider` reach the same conclusion for the
 * Retirement nav entry and the theme.
 *
 * ⚠️ THE RULE IS `=== '1'`, NEVER TRUTHINESS, and it must stay byte-identical
 * to `wasAccountNoticeDismissed` in `./account-notice-dismissal`. If the two
 * readers of this key ever disagree, a value one accepts and the other rejects
 * hides the box pre-paint and restores it after hydration (or the reverse).
 * That inversion is the failure mode both modules exist to prevent.
 *
 * ⚠️ NO ATTRIBUTE CLEAN-UP IS NEEDED HERE, AND THAT IS A PROPERTY OF THIS
 * FEATURE, NOT AN OVERSIGHT. `global.css`'s planner rule carries a warning that
 * its attribute MUST be kept truthful for the document's whole lifetime,
 * because that preference is re-enablable: the <head> script only ever SETS the
 * attribute, so a user who turned the planner back on mid-session kept seeing
 * the entry hidden until a reload, and `PlannerVisibilityProvider` had to start
 * removing it. This dismissal has no re-enable path at all — it is one-way and
 * permanent (AC-2), with no settings surface to restore the box — so the
 * attribute can never outlive its truth. ⚠️ If an "undo" is ever added, that
 * changes: whatever restores the box must also REMOVE this attribute, or the
 * box will stay invisible until a reload.
 *
 * Wrapped in try/catch so blocked or corrupt storage never throws (mirrors
 * StoreHydration's swallow-errors discipline).
 *
 * The key, the sentinel value and the attribute name are ALL interpolated from
 * `./account-notice-dismissal` — the single source of truth. The script body is
 * assembled at module-evaluation time, so nothing here needs to be hard-coded;
 * an earlier version of this comment claimed the value had to be, "because this
 * runs before any module can load", which was false (the key was already
 * interpolated the same way) and left a duplicated sentinel that only two
 * hand-maintained parallel test tables kept honest. Corrected in code review.
 *
 * Extracted to this leaf module (mirroring `lib/theme/no-flash-theme-script`
 * and `lib/nav/no-flash-planner-visibility-script`) so the exact rendered
 * script body is one importable source of truth shared by two consumers that
 * must never drift apart:
 *   1. `routes/__root.tsx` — renders it as an inline `<script>`.
 *   2. `server/middleware/security-headers.ts` — hashes it (sha256) to pin the
 *      Content-Security-Policy `script-src`.
 *
 * Never re-inline a divergent copy in either place: the hash is derived from
 * this constant, so a copy that drifts is a script the CSP blocks, in
 * production only, silently.
 */
export const NO_FLASH_ACCOUNT_NOTICE_SCRIPT = `(function(){try{if(localStorage.getItem('${ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY}')==='${DISMISSED_VALUE}'){document.documentElement.setAttribute('${ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE}','${DISMISSED_VALUE}');}}catch(e){}})();`
