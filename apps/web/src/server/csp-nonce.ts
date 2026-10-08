/**
 * Server only. getRouter() must not import this (node:async_hooks would break client
 * hydration), so the nonce getter is exposed via globalThis instead.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { CSP_NONCE_GLOBAL_KEY } from './csp-nonce-key'

const nonceStorage = new AsyncLocalStorage<string>()
;(globalThis as Record<string, unknown>)[CSP_NONCE_GLOBAL_KEY] = (): string | undefined =>
	nonceStorage.getStore()

export function generateCspNonce(): string {
	return randomBytes(16).toString('base64')
}

export function runWithCspNonce<T>(nonce: string, fn: () => T): T {
	return nonceStorage.run(nonce, fn)
}
