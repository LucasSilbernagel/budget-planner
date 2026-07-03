/**
 * Test double for vite-plugin-pwa's `virtual:pwa-register` module (story 7-1).
 *
 * The PWA plugin is only registered in vite.config.ts (the app/build), not in
 * vitest.config.ts, so the virtual module cannot be resolved under the test
 * runner. vitest.config.ts aliases `virtual:pwa-register` to this file so
 * component tests (RegisterSW) can render and assert that registration is
 * invoked. `registerSW` is a spy; clear it between tests.
 */

import { vi } from 'vitest'

export const registerSW = vi.fn()
