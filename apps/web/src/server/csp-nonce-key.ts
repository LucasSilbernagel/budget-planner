/**
 * The `globalThis` key under which the server-only `csp-nonce` module registers
 * its per-request nonce getter (story sec-1).
 *
 * Isolated in this tiny, dependency-free module so the isomorphic `getRouter()`
 * can import the key WITHOUT importing `server/csp-nonce.ts` — which pulls in
 * `node:async_hooks`/`node:crypto` and must never enter the client bundle.
 */
export const CSP_NONCE_GLOBAL_KEY = '__budgetPlannerCspNonce'
