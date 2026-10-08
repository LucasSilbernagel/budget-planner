/**
 * Rows are written through the real stores, so a renamed key or field turns red instead of
 * silently shrinking the pending block.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { OVERVIEW_DATA_STORES } from '../../../stores/overview-data-storage-keys'
import { useSavingsStore } from '../../../stores/savingsStore'
import {
  NO_FLASH_OVERVIEW_DATA_SCRIPT,
  OVERVIEW_HAS_DATA_ATTRIBUTE,
} from '../no-flash-overview-data-script'

function runScript(): void {
  new Function(NO_FLASH_OVERVIEW_DATA_SCRIPT)()
}

function marked(): string | null {
  return document.documentElement.getAttribute(OVERVIEW_HAS_DATA_ATTRIBUTE)
}

const ROW = { id: 'row-1' }

const WRITERS: [string, () => void][] = [
  ['an income source', () => useIncomeStore.setState({ incomeSources: [ROW] } as never)],
  ['an expense', () => useExpenseStore.setState({ expenses: [ROW] } as never)],
  ['a savings goal', () => useSavingsStore.setState({ savingsGoals: [ROW] } as never)],
  ['a balance entry', () => useBalanceStore.setState({ entries: [ROW] } as never)],
]

function emptyAllStores(): void {
  useIncomeStore.setState({ incomeSources: [] } as never)
  useExpenseStore.setState({ expenses: [] } as never)
  useSavingsStore.setState({ savingsGoals: [] } as never)
  useBalanceStore.setState({ entries: [] } as never)
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(OVERVIEW_HAS_DATA_ATTRIBUTE)
})

afterEach(() => {
  vi.restoreAllMocks()
  emptyAllStores()
  localStorage.clear()
  document.documentElement.removeAttribute(OVERVIEW_HAS_DATA_ATTRIBUTE)
})

describe('NO_FLASH_OVERVIEW_DATA_SCRIPT', () => {
  it('leaves <html> unmarked in a browser with no stored budget', () => {
    runScript()
    expect(marked()).toBeNull()
  })

  for (const [what, write] of WRITERS) {
    it(`marks <html> when the browser holds only ${what}`, () => {
      write()
      runScript()
      expect(marked()).toBe('1')
    })
  }

  it('leaves <html> unmarked when all four stores are saved but empty', () => {
    emptyAllStores()
    for (const [key] of OVERVIEW_DATA_STORES) expect(localStorage.getItem(key)).not.toBeNull()
    runScript()
    expect(marked()).toBeNull()
  })

  it('reads past a corrupt key to a store that has rows', () => {
    const [[firstKey]] = OVERVIEW_DATA_STORES as [readonly [string, string]]
    localStorage.setItem(firstKey, '{not json')
    useBalanceStore.setState({ entries: [ROW] } as never)
    runScript()
    expect(marked()).toBe('1')
  })

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(runScript).not.toThrow()
    expect(marked()).toBeNull()
  })
})
