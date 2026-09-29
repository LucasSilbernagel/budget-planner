/**
 * The slice of `jsdom`'s API the `*.db.test.*` files use, and nothing more.
 *
 * Story 78.2: `jsdom` ships no types, and `@types/jsdom` has no line for the
 * installed jsdom 24 (it jumps 21.x -> 28.x) while pulling `@types/node` into
 * every test program as a global. Five test files build a JSDOM window to back
 * `localStorage`/`navigator` under the node environment; this declares exactly
 * the constructor and `window` they touch, typed as the DOM `Window` those
 * files already treat it as.
 *
 * ⚠️ Must stay a SCRIPT (no top-level import/export) so this is an ambient
 * module declaration, not an augmentation. Never replace it with a body-less
 * `declare module 'jsdom'`: that types the whole module as `any`.
 */
declare module 'jsdom' {
  export interface ConstructorOptions {
    url?: string
  }

  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions)
    readonly window: Window & typeof globalThis
  }
}
