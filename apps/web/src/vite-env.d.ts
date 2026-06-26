/// <reference types="vite/client" />

/**
 * Build-time application version, inlined by Vite/Vitest `define` from
 * apps/web/package.json (story 4-8). Declared as a global so `version.ts`
 * can reference it with full type safety.
 */
declare const __APP_VERSION__: string

/**
 * Client-exposed environment variables (story 4-11). Augments Vite's
 * `ImportMetaEnv` so `import.meta.env.VITE_ETHICALADS_PUBLISHER_ID` is typed.
 * The EthicalAds publisher id is a public identifier; it is intentionally
 * shipped to the client bundle.
 */
interface ImportMetaEnv {
  readonly VITE_ETHICALADS_PUBLISHER_ID?: string
}
