// The Paddle.js drift check (story sec-4, D2 (b)): pure, so the unit suite tests it on
// synthetic sources and `check-paddle-drift.mjs` runs it on the live, unversioned
// https://cdn.paddle.com/paddle/v2/paddle.js once a week.
//
// It checks the Paddle.js internals the app's headers and checkout code rely on:
//   1. the overlay spinner <style> text, authorized by its sha256 in production
//      `style-src-elem` (`PADDLE_LOADER_STYLE_CSP_HASH`);
//   2. ProfitWell's `window.profitwell?.isLoaded` skip, which the `window.profitwell`
//      stub in `lib/paddle/checkout.ts` relies on (sec-4 D1);
//   3. the checkout frame's `allow = 'payment'` and its origins, which
//      `Permissions-Policy: payment=(…)` names (`PADDLE_CHECKOUT_FRAME_ORIGIN`).
// Every value is matched against the MINIFIED file, so the patterns below are the
// minifier's shapes (measured on the build `last-modified: Thu, 24 Sep 2026 14:05:20 GMT`).

import { createHash } from 'node:crypto'

export const PADDLE_JS_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js'

/** Every `.innerHTML="…keyframes rotate…"` string literal (the spinner <style> text). */
const LOADER_STYLE_RE = /\.innerHTML=("(?:[^"\\]|\\.)*keyframes rotate(?:[^"\\]|\\.)*")/g

/**
 * `initPwSnippet`'s first line, `if (window.profitwell?.isLoaded) return`, in the shapes a
 * minifier gives optional chaining (sec-4 review): TypeScript's downlevel
 * (`null===(t=window.profitwell)||void 0===t?void 0:t.isLoaded`, the live build), its
 * `===null||===void 0` variant, terser's (`null==(t=window.profitwell)?void 0:t.isLoaded`),
 * esbuild/swc's (`(t=window.profitwell)==null?void 0:t.isLoaded`), or unminified. Identifiers
 * may carry `$`. Any other shape is reported as "gone or reshaped" (a red run to look at, by
 * design).
 */
const PROFITWELL_GUARD_RE = new RegExp(
  [
    String.raw`\(([\w$]+)=window\.profitwell\)\|\|void 0===\1\?void 0:\1\.isLoaded`,
    String.raw`\(([\w$]+)=window\.profitwell\)===null\|\|\2===void 0\?void 0:\2\.isLoaded`,
    String.raw`null==\(([\w$]+)=window\.profitwell\)\?void 0:\3\.isLoaded`,
    String.raw`\(([\w$]+)=window\.profitwell\)==null\?void 0:\4\.isLoaded`,
    String.raw`window\.profitwell\?\.isLoaded`,
  ].join('|')
)

const FRAME_ALLOW_PAYMENT_RE = /\.allow="payment"/

/** The CSP source expression for a <style> text: `sha256-<base64>`. */
export function cspSha256(text) {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`
}

/**
 * @param {string} source paddle.js as served.
 * @param {{ loaderStyleText: string, checkoutFrameOrigins: { production: string, sandbox: string } }} pinned
 * @returns {{ problems: string[], facts: string[] }}
 */
export function checkPaddleJs(source, pinned) {
  const problems = []
  const facts = []

  // The capture is a JS string literal; JSON.parse reads it only while its escapes are also
  // JSON's (today: `\t` only). A JS-only escape (`\x09`, `\'`, `\0`, `\v`, `\u{…}`) is drift
  // too, reported rather than thrown (sec-4 review).
  const literals = []
  for (const m of source.matchAll(LOADER_STYLE_RE)) {
    try {
      literals.push(JSON.parse(m[1]))
    } catch {
      problems.push(
        `A spinner <style> literal (".innerHTML=…keyframes rotate…") now uses a JavaScript-only string escape, so its text could not be decoded: ${m[1].slice(
          0,
          80
        )}…. Re-read paddle.js's showLoading() (src/utils/checkout.ts in its source map), update PADDLE_LOADER_STYLE_TEXT in apps/web/src/lib/paddle/paddle-js-internals.ts, and teach LOADER_STYLE_RE's decoder the new escape.`
      )
    }
  }
  facts.push(`spinner <style> literals found: ${literals.length}`)
  if (problems.length) {
    // An undecodable literal already explains itself; the count check below would repeat it.
  } else if (literals.length !== 1) {
    problems.push(
      `Expected exactly 1 spinner <style> literal (".innerHTML=…keyframes rotate…"), found ${literals.length}. Re-read paddle.js's showLoading() (src/utils/checkout.ts in its source map) and update PADDLE_LOADER_STYLE_TEXT in apps/web/src/lib/paddle/paddle-js-internals.ts.`
    )
  } else {
    const live = cspSha256(literals[0])
    const ours = cspSha256(pinned.loaderStyleText)
    facts.push(`spinner <style> hash: live ${live}, pinned ${ours}`)
    if (literals[0] !== pinned.loaderStyleText) {
      problems.push(
        `Paddle changed the overlay spinner <style>: live ${live} (${
          literals[0].length
        } chars), pinned ${ours}. Production style-src-elem now refuses it (one console error per checkout open; checkout still works). Update PADDLE_LOADER_STYLE_TEXT in apps/web/src/lib/paddle/paddle-js-internals.ts to this exact text. Then re-capture the hash Chrome reports when the overlay opens under the OLD policy (the external witness CHROME_REPORTED_LOADER_STYLE_HASH in security-headers.test.ts pins); do not type ${live} in from this message: ${JSON.stringify(
          literals[0]
        )}`
      )
    }
  }

  if (PROFITWELL_GUARD_RE.test(source)) {
    facts.push('ProfitWell isLoaded guard: present')
  } else {
    problems.push(
      "The `window.profitwell?.isLoaded` guard in paddle.js's initPwSnippet (src/gateway/profitwell.gateway.ts) is gone or reshaped. The window.profitwell stub in apps/web/src/lib/paddle/checkout.ts (story sec-4, D1) may no longer stop ProfitWell, so live /pricing logs the blocked profitwell.js again. Re-read the source map and revisit sec-4 D1."
    )
  }

  if (FRAME_ALLOW_PAYMENT_RE.test(source)) {
    facts.push('checkout frame allow="payment": present')
  } else {
    problems.push(
      'The checkout iframe no longer sets allow="payment" (src/gateway/iframe.gateway.ts). Permissions-Policy payment=(…) in apps/web/src/server/middleware/security-headers.ts may now be pointless or wrong: re-read and revisit sec-4 AC-4.'
    )
  }

  for (const [env, origin] of Object.entries(pinned.checkoutFrameOrigins)) {
    if (source.includes(`checkoutFrontEndBase:"${origin}"`)) {
      facts.push(`checkout frame origin (${env}): ${origin}`)
    } else {
      problems.push(
        `paddle.js no longer has checkoutFrontEndBase "${origin}" (${env}, src/constants/resources.ts). Permissions-Policy payment=(…) names a frame origin Paddle does not load any more: update PADDLE_CHECKOUT_FRAME_ORIGIN in apps/web/src/lib/paddle/paddle-js-internals.ts.`
      )
    }
  }

  return { problems, facts }
}
