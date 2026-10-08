/**
 * Copies of Paddle's unversioned paddle.js; the weekly drift check fails when they change. A leaf
 * module with only erasable TypeScript: the drift script imports it via Node type stripping.
 */

/** The overlay spinner <style> text; CSP authorizes it by sha256, so one changed character blocks it. */
export const PADDLE_LOADER_STYLE_TEXT =
	'\t\t\t\t@-webkit-keyframes rotate {\t\t\t\t\t0% {\t\t\t\t\t\t-webkit-transform: rotate(45deg);\t\t\t\t\t}\t\t\t\t\t100% {\t\t\t\t\t\t-webkit-transform: rotate(405deg);\t\t\t\t\t}\t\t\t\t}\t\t\t\t@keyframes rotate {\t\t\t\t\tfrom {\t\t\t\t\t\ttransform: rotate(45deg);\t\t\t\t\t}\t\t\t\t\tto {\t\t\t\t\t\ttransform: rotate(405deg);\t\t\t\t\t}\t\t\t\t}'

/** `Permissions-Policy: payment=` must name this origin, or Apple/Google Pay is disabled in the frame. */
export const PADDLE_CHECKOUT_FRAME_ORIGIN = {
	production: 'https://buy.paddle.com',
	sandbox: 'https://sandbox-buy.paddle.com',
} as const
