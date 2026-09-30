// @vitest-environment node
/**
 * Story 82.2: under the node environment there is no Web Storage, on every Node.
 *
 * Node 20 has no `localStorage` global. Node 25+ defines one, and on Node 26 it
 * is a getter that returns `undefined` (or, with `--localstorage-file`, a SQLite
 * store shared by every worker and every run). `src/test/webstorage.ts` removes
 * it, so a node-env test sees what CI's Node 20 sees.
 *
 * The shim's branches are also driven against a plain object carrying a
 * Node-style getter, so they are tested on Node 20 (CI) too, where the real
 * global has nothing to remove.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installWebStorage } from '../webstorage'

const withNodeStyleStorage = (configurable = true) => {
  const target = {}
  for (const key of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(target, key, { get: () => undefined, configurable, enumerable: true })
  }
  return target
}

describe('Web Storage under the node environment', () => {
  it('has no localStorage or sessionStorage global', () => {
    expect('localStorage' in globalThis).toBe(false)
    expect('sessionStorage' in globalThis).toBe(false)
  })

  it('removes a Node-style storage getter', () => {
    const target = withNodeStyleStorage()
    installWebStorage(target)
    expect('localStorage' in target).toBe(false)
    expect('sessionStorage' in target).toBe(false)
  })

  it('fails loudly if a Node makes the global non-configurable', () => {
    expect(() => installWebStorage(withNodeStyleStorage(false))).toThrow(
      /localStorage is not configurable/
    )
  })

  it('refuses a DOM environment that is not vitest’s jsdom', () => {
    const target = { ...withNodeStyleStorage(), document: {} }
    expect(() => installWebStorage(target)).toThrow(/without `globalThis.jsdom`/)
  })
})

describe('vitest.setup.ts evaluates the shim before any store', () => {
  // zustand's persist binds storage when a store module is evaluated. Biome's
  // import sort moves a side-effect import to the END of an import group, so the
  // blank line after it (its own group) is load-bearing.
  const lines = readFileSync(join(__dirname, '../../../vitest.setup.ts'), 'utf8').split('\n')
  const first = lines.findIndex((line) => line.startsWith('import '))

  it('imports the shim first, in its own import group', () => {
    expect(lines[first]).toBe("import './src/test/webstorage'")
    expect(lines[first + 1]).toBe('')
  })
})
