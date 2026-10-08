/** vitest.config aliases `virtual:pwa-register` here: the PWA plugin is not loaded under vitest. */

import { vi } from 'vitest'

export const registerSW = vi.fn()
