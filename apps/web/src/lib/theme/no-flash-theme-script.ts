import { THEME_STORAGE_KEY } from '../../stores/themeStore'

/**
 * No-flash theme bootstrap (story 7-3, AC-4). Runs synchronously in <head>
 * before first paint: reads the persisted theme from localStorage and adds the
 * `.dark` class to <html> so a paid user's dark preference paints correctly on
 * the very first frame — no flash of light before React hydrates. Wrapped in
 * try/catch so blocked or corrupt storage never throws (mirrors StoreHydration's
 * swallow-errors discipline). ThemeProvider reconciles + enforces the
 * premium-gate correction after mount.
 *
 * The storage key comes from `THEME_STORAGE_KEY` (single source of truth in
 * themeStore); the persisted `{ state: { theme } }` shape is still hard-parsed
 * here because this runs before any module can load. See that constant's JSDoc.
 *
 * Extracted to this leaf module (story sec-1) so the exact rendered script body
 * is a single importable source of truth shared by two consumers that must never
 * drift apart:
 *   1. `routes/__root.tsx` — renders it as an inline `<script>` (the only inline
 *      script in the document).
 *   2. `server/middleware/security-headers.ts` — hashes it (sha256) to pin the
 *      Content-Security-Policy `script-src`, so the strict CSP allows exactly
 *      this script and nothing else inline.
 *
 * Keeping it here (a React/CSS-free leaf that only depends on the theme storage
 * key) lets the security-headers unit test import and hash it without pulling the
 * whole route/component tree into a `node`-environment test.
 */
export const NO_FLASH_THEME_SCRIPT = `(function(){try{var raw=localStorage.getItem('${THEME_STORAGE_KEY}');if(!raw)return;var parsed=JSON.parse(raw);var theme=parsed&&parsed.state&&parsed.state.theme;if(theme==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`
