/**
 * Vitest Setup File
 *
 * Global test setup for @budget-planner/core package
 * Mocks browser APIs for Node.js environment
 *
 * Phase 1: Environment Fixes - Fix localStorage mocking
 */

import { afterEach, beforeEach, vi } from 'vitest'

// Mock localStorage for Node.js environment
// This is needed because some modules (balanceTracking, synchronization) use localStorage
// which is not available in Node.js
beforeEach(() => {
  // Create a mock localStorage object
  const mockLocalStorage = {
    store: {} as Record<string, string>,
    getItem: vi.fn((key: string): string | null => {
      return mockLocalStorage.store[key] ?? null
    }),
    setItem: vi.fn((key: string, value: string): void => {
      mockLocalStorage.store[key] = value
    }),
    removeItem: vi.fn((key: string): void => {
      delete mockLocalStorage.store[key]
    }),
    clear: vi.fn((): void => {
      mockLocalStorage.store = {}
    }),
    key: vi.fn((index: number): string | null => {
      const keys = Object.keys(mockLocalStorage.store)
      // keys[index] can be undefined according to TypeScript, coerce to null when absent
      return index < keys.length ? keys[index] ?? null : null
    }),
    length: 0,
  }

  // Update length property
  Object.defineProperty(mockLocalStorage, 'length', {
    get: () => Object.keys(mockLocalStorage.store).length,
    configurable: true,
  })

  // Assign to global
  // Use type assertion to work around Node.js environment lacking DOM types
  global.localStorage = mockLocalStorage as unknown as {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
    removeItem: (key: string) => void
    clear: () => void
    key: (index: number) => string | null
    length: number
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})
