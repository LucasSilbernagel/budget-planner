// The real input is the live, unversioned paddle.js, which no unit test may fetch, so these use
// synthetic sources in the measured MINIFIED shapes.

import { describe, expect, it } from 'vitest'
import { checkPaddleJs, cspSha256 } from '../../scripts/paddle-drift-lib.mjs'
import {
	PADDLE_CHECKOUT_FRAME_ORIGIN,
	PADDLE_LOADER_STYLE_TEXT,
} from '../lib/paddle/paddle-js-internals'
import { PADDLE_LOADER_STYLE_CSP_HASH } from '../server/middleware/security-headers'

const PINNED = {
	loaderStyleText: PADDLE_LOADER_STYLE_TEXT,
	checkoutFrameOrigins: PADDLE_CHECKOUT_FRAME_ORIGIN,
}

function paddleJs(
	overrides: { loader?: string[]; guard?: string; allow?: string; origins?: string[] } = {}
) {
	const loader = overrides.loader ?? [PADDLE_LOADER_STYLE_TEXT]
	const origins = overrides.origins ?? ['https://sandbox-buy.paddle.com', 'https://buy.paddle.com']
	return [
		...origins.map((o) => `var u={checkoutBase:"x",checkoutFrontEndBase:"${o}",apiBase:"y"};`),
		`function It(){var t;if(!(${
			overrides.guard ?? 'null===(t=window.profitwell)||void 0===t?void 0:t.isLoaded'
		})){var e=nt.get();}}`,
		...loader.map(
			(text) =>
				`function Rt(){var t=document.createElement("style");t.type="text/css",t.innerHTML=${JSON.stringify(
					text
				)},document.head.appendChild(t)}`
		),
		`window.PaddleFrame.allowTransparency="true",${
			overrides.allow ?? 'window.PaddleFrame.allow="payment"'
		},n){}`,
	].join('\n')
}

describe('checkPaddleJs (sec-4 D2)', () => {
	it('finds nothing wrong in a paddle.js that matches every pinned internal', () => {
		const { problems, facts } = checkPaddleJs(paddleJs(), PINNED)
		expect(problems).toEqual([])
		expect(facts).toContain(
			`spinner <style> hash: live ${PADDLE_LOADER_STYLE_CSP_HASH}, pinned ${PADDLE_LOADER_STYLE_CSP_HASH}`
		)
	})

	it('computes the same hash the CSP carries', () => {
		expect(cspSha256(PADDLE_LOADER_STYLE_TEXT)).toBe(PADDLE_LOADER_STYLE_CSP_HASH)
	})

	it('fails when Paddle changes ONE character of the spinner <style>', () => {
		const drifted = PADDLE_LOADER_STYLE_TEXT.replace('405deg', '406deg')
		const { problems } = checkPaddleJs(paddleJs({ loader: [drifted] }), PINNED)
		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain('Paddle changed the overlay spinner <style>')
		expect(problems[0]).toContain(cspSha256(drifted))
	})

	it.each([
		[0, []],
		[2, [PADDLE_LOADER_STYLE_TEXT, PADDLE_LOADER_STYLE_TEXT]],
	])('fails when it finds %i spinner literals instead of exactly 1', (count, loader) => {
		const { problems } = checkPaddleJs(paddleJs({ loader }), PINNED)
		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain(`found ${count}`)
	})

	// A JS string literal may use escapes JSON lacks: that is drift to report, not a crash.
	it('reports, rather than throws on, a spinner literal with a JavaScript-only escape', () => {
		const source = paddleJs().replace(
			`t.innerHTML=${JSON.stringify(PADDLE_LOADER_STYLE_TEXT)}`,
			't.innerHTML="\\x09@-webkit-keyframes rotate {}"'
		)
		expect(source).toContain('\\x09')
		const { problems } = checkPaddleJs(source, PINNED)
		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain('JavaScript-only string escape')
	})

	it.each([
		['unminified', 'window.profitwell?.isLoaded'],
		['TypeScript ===null variant', '(e$=window.profitwell)===null||e$===void 0?void 0:e$.isLoaded'],
		['terser', 'null==(t=window.profitwell)?void 0:t.isLoaded'],
		['esbuild / swc', '(t=window.profitwell)==null?void 0:t.isLoaded'],
	])("accepts the guard's %s form too", (_name, guard) => {
		const { problems } = checkPaddleJs(paddleJs({ guard }), PINNED)
		expect(problems).toEqual([])
	})

	it('rejects a guard whose temporaries do not match (not the same optional chain)', () => {
		const { problems } = checkPaddleJs(
			paddleJs({ guard: 'null===(t=window.profitwell)||void 0===e?void 0:e.isLoaded' }),
			PINNED
		)
		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain('isLoaded')
	})

	it('fails when the ProfitWell isLoaded guard is gone (the D1 stub would stop working)', () => {
		const { problems } = checkPaddleJs(
			paddleJs({ guard: 'null===(t=window.profitwell)||void 0===t?void 0:t.isReady' }),
			PINNED
		)
		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain('isLoaded')
	})

	it('fails when the checkout frame no longer sets allow="payment"', () => {
		const { problems } = checkPaddleJs(paddleJs({ allow: 'window.PaddleFrame.allow=""' }), PINNED)
		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain('allow="payment"')
	})

	it.each([
		['production', ['https://sandbox-buy.paddle.com', 'https://checkout.paddle.com']],
		['sandbox', ['https://sandbox-checkout.paddle.com', 'https://buy.paddle.com']],
	])('fails when the %s checkout frame origin changes', (env, origins) => {
		const { problems } = checkPaddleJs(paddleJs({ origins }), PINNED)
		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain(`(${env}`)
	})
})
