// @vitest-environment jsdom
// On Node 26 vitest skipped jsdom's own storage because Node already defines `localStorage`.
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { installWebStorage } from '../webstorage'

const dom = (globalThis as { jsdom?: { window: Window } }).jsdom

describe('Web Storage under the jsdom environment', () => {
  it('is the storage of this file’s own jsdom window', () => {
    expect(dom).toBeDefined()
    expect(localStorage).toBe(dom?.window.localStorage)
    expect(sessionStorage).toBe(dom?.window.sessionStorage)
    expect(window.localStorage).toBe(dom?.window.localStorage)
  })

  it('is where a store imported by vitest.setup.ts persists', () => {
    // `vitest.setup.ts` resets the currency store through persist; had the store bound its storage
    // before the shim ran, that write would not land here.
    expect(dom?.window.localStorage.getItem('budget-planner-currency-prefs-v1')).not.toBeNull()
  })

  it('replaces a Node-style storage getter with the jsdom window’s', () => {
    // Drives the branch on any Node: on Node 20 the real global has no getter.
    const win = new JSDOM('', { url: 'http://localhost/' }).window
    const target = { jsdom: { window: win } }
    Object.defineProperty(target, 'localStorage', { get: () => undefined, configurable: true })
    installWebStorage(target)
    expect((target as { localStorage?: Storage }).localStorage).toBe(win.localStorage)
    expect((target as { sessionStorage?: Storage }).sessionStorage).toBe(win.sessionStorage)
  })

  it('names itself when jsdom refuses storage (opaque origin)', () => {
    const target = { jsdom: { window: new JSDOM('', { url: 'about:blank' }).window } }
    expect(() => installWebStorage(target)).toThrow(/webstorage shim: jsdom has no localStorage/)
  })
})
