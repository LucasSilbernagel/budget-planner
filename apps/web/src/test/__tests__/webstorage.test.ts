// @vitest-environment node
// Node 25+ defines `localStorage` (on 26 a getter returning undefined, or a SQLite store shared
// across workers); the shim removes it so node-env tests match Node 20.
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
  // persist binds storage at store-module evaluation, and Biome sorts a side-effect import
  // to the END of its group, so the blank line after it is load-bearing.
  const lines = readFileSync(join(__dirname, '../../../vitest.setup.ts'), 'utf8').split('\n')
  const first = lines.findIndex((line) => line.startsWith('import '))

  it('imports the shim first, in its own import group', () => {
    expect(lines[first]).toBe("import './src/test/webstorage'")
    expect(lines[first + 1]).toBe('')
  })
})
