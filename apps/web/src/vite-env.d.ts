/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Build-time application version, inlined by Vite/Vitest `define` from
 * apps/web/package.json (story 4-8). Declared as a global so `version.ts`
 * can reference it with full type safety.
 */
declare const __APP_VERSION__: string

/**
 * Client-exposed environment variables. Augments Vite's `ImportMetaEnv` so the
 * `VITE_`-prefixed values below are typed on `import.meta.env`.
 *
 * `VITE_FORMSPARK_FORM_ID` (story 9-1) is a *public* identifier — the
 * Formspark form id ships in client HTML on the submit URL by design, so it is
 * not a secret. When unset (local dev / before the Formspark form exists) the
 * contact form degrades gracefully rather than posting to an undefined endpoint.
 *
 * `VITE_COUNTERDEV_ID` (story 10-1) is likewise a *public* identifier — the
 * counter.dev site id ships in client HTML on the analytics `<script data-id>`
 * by design, so it is not a secret. When unset (local dev / before the
 * counter.dev account exists) the analytics script is simply omitted.
 */
interface ImportMetaEnv {
  readonly VITE_FORMSPARK_FORM_ID?: string
  readonly VITE_COUNTERDEV_ID?: string
}
