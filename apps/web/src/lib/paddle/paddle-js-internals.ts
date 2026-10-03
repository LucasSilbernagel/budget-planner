/**
 * The Paddle.js internals this app's security headers depend on (story sec-4).
 *
 * Paddle.js is loaded from an UNVERSIONED URL (`https://cdn.paddle.com/paddle/v2/paddle.js`;
 * `@paddle/paddle-js`'s `initializePaddle` "always downloads the latest version"), so every
 * value here is a copy of Paddle's code that Paddle can change on any day. Each was read
 * from that file's public source map at the build `last-modified: Thu, 24 Sep 2026 14:05:20
 * GMT`, sha256 `5cf0d33479fa8326972b4a62f2816d08e9dd7cb0c623491598463dd798c62e9b`.
 *
 * The weekly `.github/workflows/paddle-drift.yml` (`scripts/check-paddle-drift.mjs`)
 * fetches the live file and fails red when any of them no longer matches.
 *
 * ⚠️ A LEAF module: no imports, only erasable TypeScript. The drift script imports this
 * file directly with Node's type stripping, so it must stay loadable that way.
 */

/**
 * The exact text of the `<style>` Paddle.js appends to `<head>` for the overlay's loading
 * spinner: `showLoading()` in paddle.js `src/utils/checkout.ts:15-33` (appended at `:35`),
 * called for every OVERLAY open. Two `rotate` keyframes; the tabs come from JS line
 * continuations in Paddle's template literal. 270 characters.
 *
 * `security-headers.ts` authorizes it in production `style-src-elem` by the sha256 of this
 * text (`PADDLE_LOADER_STYLE_CSP_HASH`). One changed character = a different hash = the
 * spinner `<style>` refused again (one console error; checkout still works).
 */
export const PADDLE_LOADER_STYLE_TEXT =
  '\t\t\t\t@-webkit-keyframes rotate {\t\t\t\t\t0% {\t\t\t\t\t\t-webkit-transform: rotate(45deg);\t\t\t\t\t}\t\t\t\t\t100% {\t\t\t\t\t\t-webkit-transform: rotate(405deg);\t\t\t\t\t}\t\t\t\t}\t\t\t\t@keyframes rotate {\t\t\t\t\tfrom {\t\t\t\t\t\ttransform: rotate(45deg);\t\t\t\t\t}\t\t\t\t\tto {\t\t\t\t\t\ttransform: rotate(405deg);\t\t\t\t\t}\t\t\t\t}'

/**
 * The origin of Paddle's checkout `<iframe name="paddle_frame" allow="payment">`, per
 * Paddle environment: `checkoutFrontEndBase` in paddle.js `src/constants/resources.ts:63-76`
 * (the frame `src` is built from it, `src/utils/urls.ts:132-137`; `allow = 'payment'` is set
 * at `src/gateway/iframe.gateway.ts:57`). `Permissions-Policy: payment=(…)` must name it, or
 * the Payment Request API (Apple Pay / Google Pay) is disabled inside the frame.
 */
export const PADDLE_CHECKOUT_FRAME_ORIGIN = {
  production: 'https://buy.paddle.com',
  sandbox: 'https://sandbox-buy.paddle.com',
} as const
