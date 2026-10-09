/** vitest.config aliases `virtual:pwa-register` here: the PWA plugin is not loaded under vitest. */

import { type Mock, vi } from 'vitest'

export const registerSW: Mock = vi.fn()
