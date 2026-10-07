import { OVERVIEW_DATA_STORES } from '../../stores/overview-data-storage-keys'

/** Set on `<html>` (value `'1'`) by the bootstrap below when this browser holds budget data. */
export const OVERVIEW_HAS_DATA_ATTRIBUTE = 'data-overview-has-data'

/** `data-hook` of the Overview's pending block, the target of the `global.css` rule. */
export const OVERVIEW_SECTIONS_PENDING_HOOK = 'overview-sections-pending'

/**
 * Pre-paint bootstrap for the Overview's pending block (story 117.2, FR185).
 * Runs synchronously in <head> before first paint: when any of the four stores
 * the Overview's `hasData` reads holds a non-empty array, it marks <html> with
 * `data-overview-has-data="1"`, and the rule in `styles/global.css` makes the
 * pending block (`overview-sections-skeleton`) at least one viewport tall.
 *
 * ⚠️ WHY. The server cannot read localStorage, so the pending block is sized
 * like the resolved-EMPTY onboarding card (story 38.2): a new visitor sees no
 * shift. A returning visitor WITH data saw the block grow by ~890 px into the
 * charts, which pushed the "Premium Features" section from inside the desktop
 * viewport to below it: CLS 0.1285 at 1350×940, MEASURED (story 117.2). With a
 * viewport-tall block, everything after it starts below the fold and stays
 * there, and a shift that starts and ends outside the viewport counts as 0.
 * Hiding "Premium Features" until hydration instead is ruled out: the SEO fence
 * in `src/__tests__/served-pages.served.test.ts` requires it in the server HTML.
 *
 * ⚠️ THE RULE MIRRORS `hasData` (HomePage.tsx): any of the four arrays has a
 * row. Two KNOWN divergences, both in the safe direction (a taller pending
 * block, never a shorter one):
 *   1. `hasData` counts rows in the ACTIVE PROFILE only (`scopeToActiveProfile`);
 *      this counts every row. A paid user whose active profile is empty but
 *      another is not gets the tall block, then the empty card (content below
 *      moves up into view). Mirroring the profile filter here would copy
 *      `profile-scope.ts` into a string; not worth it for that case.
 *   2. A key that is present but unparsable counts as no data for that store.
 * The attribute is never removed: the pending block shows only before the
 * Overview's `hydrated` flag turns true, and the rule targets nothing else.
 * (`hydrated` can return to false in one case: a paid session's first-ever pull
 * still in flight after the user deletes their last row. The block is then
 * just taller.)
 *
 * Each store is read in its own try/catch, so blocked or corrupt storage never
 * throws (mirrors StoreHydration's swallow-errors discipline), and one corrupt
 * key does not hide another store's rows.
 *
 * The keys and field names are interpolated from
 * `stores/overview-data-storage-keys` (the stores' own source for them), and the
 * attribute from the constant above. Extracted to this leaf module, like
 * `./no-flash-account-notice-script`, so the exact script body is one importable
 * source shared by:
 *   1. `routes/__root.tsx`: renders it as an inline `<script>`.
 *   2. `server/middleware/security-headers.ts`: hashes it (sha256) into the
 *      Content-Security-Policy `script-src`.
 * Never re-inline a divergent copy in either place: a copy that drifts is a
 * script the CSP blocks, in production only, silently.
 */
export const NO_FLASH_OVERVIEW_DATA_SCRIPT = `(function(){var s=${JSON.stringify(
  OVERVIEW_DATA_STORES
)};for(var i=0;i<s.length;i++){try{var raw=localStorage.getItem(s[i][0]);if(!raw)continue;var p=JSON.parse(raw);var rows=p&&p.state&&p.state[s[i][1]];if(Array.isArray(rows)&&rows.length>0){document.documentElement.setAttribute('${OVERVIEW_HAS_DATA_ATTRIBUTE}','1');return;}}catch(e){}}})();`
