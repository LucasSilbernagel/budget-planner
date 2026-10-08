// Patterns match the minified live paddle.js, so they are the minifier's shapes.

import { createHash } from 'node:crypto'

export const PADDLE_JS_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js'

const LOADER_STYLE_RE = /\.innerHTML=("(?:[^"\\]|\\.)*keyframes rotate(?:[^"\\]|\\.)*")/g

/**
 * The `window.profitwell?.isLoaded` guard in each shape minifiers give optional chaining;
 * any other shape is reported as drift by design.
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

export function cspSha256(text) {
	return `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`
}

export function checkPaddleJs(source, pinned) {
	const problems = []
	const facts = []

	// JSON.parse reads the JS literal only while its escapes are also JSON's; a JS-only
	// escape is drift too, reported rather than thrown.
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
	if (problems.length > 0) {
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
