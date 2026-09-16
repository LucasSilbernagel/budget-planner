// @ts-check
/**
 * Container entrypoint dispatcher (Story 5-18, AC-2).
 *
 * One image, two modes. `docker run` / Rapids always starts THIS file; what it
 * becomes is decided once, here, from `APP_ENTRYPOINT`:
 *
 *   unset (or anything else) → `serve-entry.mjs`   — SSR + /api/* + static assets
 *   exactly `migrate`        → `migrate-entry.mjs` — apply DB migrations, report, hold
 *
 * ⚠️ Both branches are reached by DYNAMIC import, and that is load-bearing rather
 * than stylistic. A static `import` of either one would pull BOTH module graphs
 * into BOTH processes — in particular it would load the built application server
 * (`dist/server/server.js`, with the whole SSR and `/api/*` route table) into the
 * migrate container. AC-2's guarantee is that the migrate path is opt-in at boot
 * and unreachable by any route or request; keeping the graphs disjoint is how
 * that is true by construction rather than by inspection.
 *
 * Run locally:
 *   pnpm --filter web build && PORT=8080 pnpm --filter web start
 */

import process from 'node:process'

import { selectEntrypoint } from './src/server/entrypoint.mjs'

const mode = selectEntrypoint(process.env)

if (mode === 'migrate') {
  await import('./migrate-entry.mjs')
} else {
  await import('./serve-entry.mjs')
}
