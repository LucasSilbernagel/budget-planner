/**
 * Kept dependency-free so the isomorphic getRouter() can import the key without
 * pulling csp-nonce.ts (node builtins) into the client bundle.
 */
export const CSP_NONCE_GLOBAL_KEY = '__budgetPlannerCspNonce'
