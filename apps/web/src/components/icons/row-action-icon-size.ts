/**
 * Hand-rolled: there is no icon package, and the CSP (`font-src`/`img-src 'self'`) rules out a CDN icon font.
 * `aria-hidden` is the contract: the wrapping button's `aria-label` is the whole accessible name.
 */

/** These SVGs set no width/height, so without a sizing class they fall back to ~300x150. */
export const ICON_SIZE = 'h-5 w-5'
