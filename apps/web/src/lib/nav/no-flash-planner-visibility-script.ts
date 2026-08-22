import { PLANNER_VISIBILITY_STORAGE_KEY } from '../../stores/plannerVisibilityStore'

/**
 * No-flash planner-visibility bootstrap (story 35.2, AC-4). Runs synchronously
 * in <head> before first paint: reads the persisted preference from
 * localStorage and marks <html> with `data-hide-retirement="1"` so the CSS rule
 * in `styles/global.css` suppresses the Retirement nav entry on the very first
 * frame — no flash of a link the user turned off.
 *
 * ⚠️ WHY THIS IS NECESSARY AND NOT BELT-AND-BRACES. Every persisted store in
 * this app is `skipHydration: true` and rehydrated in a mount effect
 * (`lib/store-hydration`), so the server render and the first client render must
 * BOTH use the deterministic default (visible) or hydration mismatches.
 *
 * ⚠️ NARROWED by story 38.1: that agreement holds for a selector that reads the
 * state object React hands it, and NOT for one that calls a state method — a
 * method closes over `get()` and returns live state even during hydration. The
 * planner-visibility read below is a plain field read, so this reasoning stands
 * here; do not generalise the sentence beyond that. See `lib/store-hydration`.
 *
 * That
 * means the React-side filter in `GlobalNav` can only ever apply *after* mount.
 * Applying the preference "after client rehydration" is therefore exactly what
 * causes the flash, not what prevents it — the same conclusion
 * `components/theme/ThemeProvider` reaches for the theme. Only a synchronous
 * <head> script beats first paint.
 *
 * ⚠️ The rule is `=== false`, never falsiness. `'false'`, `0`, `null` and a
 * missing field all mean SHOW. This mirrors `coerceVisibility` in
 * `stores/plannerVisibilityStore` — the two readers parse the same blob and MUST
 * agree, or a corrupt value hides the entry pre-paint and restores it after
 * hydration.
 *
 * Wrapped in try/catch so blocked or corrupt storage never throws (mirrors
 * StoreHydration's swallow-errors discipline).
 *
 * The storage key comes from `PLANNER_VISIBILITY_STORAGE_KEY` (single source of
 * truth in the store); the persisted `{ state: { showRetirementPlanner } }`
 * shape is still hard-parsed here because this runs before any module can load.
 *
 * Extracted to this leaf module (mirroring `lib/theme/no-flash-theme-script`) so
 * the exact rendered script body is one importable source of truth shared by two
 * consumers that must never drift apart:
 *   1. `routes/__root.tsx` — renders it as an inline `<script>`.
 *   2. `server/middleware/security-headers.ts` — hashes it (sha256) to pin the
 *      Content-Security-Policy `script-src`.
 */
/**
 * ⚠️ THE SHAPE GUARD IS LOAD-BEARING, AND A TRUTHINESS CHAIN IS NOT ENOUGH.
 * The obvious form — `var v = parsed && parsed.state && parsed.state.showRetirementPlanner`
 * — has a concrete counterexample found in review: for the blob
 * `{"state":false}` the `&&` chain evaluates to the literal `false` of the
 * *state node itself*, so `v === false` passes and the planner is hidden, while
 * the store's `merge` reads `(false)?.showRetirementPlanner === undefined` and
 * shows it. That is the pre-paint/post-hydration inversion both modules promise
 * cannot happen. `state` must be proven to be an object before its field is
 * read.
 */
export const NO_FLASH_PLANNER_SCRIPT = `(function(){try{var raw=localStorage.getItem('${PLANNER_VISIBILITY_STORAGE_KEY}');if(!raw)return;var parsed=JSON.parse(raw);var s=parsed&&typeof parsed==='object'?parsed.state:null;var v=s&&typeof s==='object'?s.showRetirementPlanner:undefined;if(v===false){document.documentElement.setAttribute('data-hide-retirement','1');}}catch(e){}})();`
