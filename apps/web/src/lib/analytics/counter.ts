/**
 * counter.dev reads its id from document.currentScript, which is null for module scripts: never
 * `type="module"`. `async` would let React 19 hoist the tag.
 */

export const COUNTERDEV_SCRIPT_SRC = 'https://cdn.counter.dev/script.js'

export interface AnalyticsScript {
	src: string
	'data-id': string
	defer: true
}

function getCounterDevId(): string {
	return (import.meta.env.VITE_COUNTERDEV_ID ?? '').trim()
}

export function buildAnalyticsScripts(): AnalyticsScript[] {
	const id = getCounterDevId()
	return id ? [{ src: COUNTERDEV_SCRIPT_SRC, 'data-id': id, defer: true }] : []
}
