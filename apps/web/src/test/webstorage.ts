// Must be the FIRST import of `vitest.setup.ts`: zustand's persist reads storage when a store
// module is evaluated. Makes every Node give jsdom files their own storage, as Node 20 does.

const KEYS = ['localStorage', 'sessionStorage'] as const

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
