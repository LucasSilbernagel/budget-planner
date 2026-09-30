/**
 * Give every test file the Web Storage that Node 20 (CI) gives it (story 82.2).
 *
 * Newer Node defines its own `localStorage`/`sessionStorage` globals (on by
 * default from Node 25; behind `--experimental-webstorage` in 22–24). Vitest's
 * jsdom environment does not replace a global that already exists, so on Node 26
 * a jsdom test got Node's storage instead of jsdom's: `undefined` without
 * `--localstorage-file`, and with it ONE SQLite file shared by every parallel
 * worker and every later run. On Node 20 there is no such global, so each jsdom
 * file gets its own window's in-memory storage and a node-env file gets none.
 * This makes every Node behave like that.
 *
 * ⚠️ Must be the FIRST import of `vitest.setup.ts`. zustand's persist reads
 * storage when a store module is evaluated, and the setup file imports stores.
 * `src/test/__tests__/webstorage.test.ts` guards that.
 */

const KEYS = ['localStorage', 'sessionStorage'] as const

/** Exported with a `target` so its branches can be tested on any Node. */
export function installWebStorage(target: object = globalThis): void {
  const scope = target as { jsdom?: { window: Window }; document?: unknown }
  const dom = scope.jsdom
  if (!dom && scope.document !== undefined) {
    // A DOM environment that is not vitest's jsdom (e.g. happy-dom). Removing
    // its storage would break it, and this shim knows nothing about it.
    throw new Error('webstorage shim: a DOM environment without `globalThis.jsdom`')
  }
  for (const key of KEYS) {
    if (dom) {
      let storage: Storage
      try {
        storage = dom.window[key]
      } catch (error) {
        // jsdom refuses storage for an opaque origin (e.g. url `about:blank`).
        throw new Error(
          `webstorage shim: jsdom has no ${key} at ${dom.window.location.href}: ${String(error)}`
        )
      }
      Object.defineProperty(target, key, {
        value: storage,
        configurable: true,
        enumerable: true,
        writable: true,
      })
    } else {
      if (Object.getOwnPropertyDescriptor(target, key)?.configurable === false) {
        throw new Error(`webstorage shim: ${key} is not configurable on Node ${process.version}`)
      }
      delete (target as Record<string, unknown>)[key]
    }
  }
}

installWebStorage()
