// Types for `paddle-drift-lib.mjs` (story sec-4), so the unit suite can import it.

export const PADDLE_JS_URL: string

export function cspSha256(text: string): string

export function checkPaddleJs(
	source: string,
	pinned: {
		loaderStyleText: string
		checkoutFrameOrigins: { production: string; sandbox: string }
	}
): { problems: string[]; facts: string[] }
