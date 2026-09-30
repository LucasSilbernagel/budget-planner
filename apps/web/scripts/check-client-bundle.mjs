// CLI for the client-bundle guard (story 83.1, FR136). Run it after a build:
//
//   pnpm --filter web build && node apps/web/scripts/check-client-bundle.mjs
//
// Exits 1 when any file in `dist/client` carries a server-only marker, or when a
// positive control fails. The logic and its rationale live in
// `client-bundle-guard-lib.mjs`. An optional argument names another dist root.

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVER_ONLY_MARKERS, checkClientBundle } from './client-bundle-guard-lib.mjs'

const distRoot = process.argv[2]
  ? resolve(process.argv[2])
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const { ok, problems } = checkClientBundle(distRoot)

if (ok) {
  console.log(
    `OK: no server-only marker (${SERVER_ONLY_MARKERS.join(', ')}) in ${join(
      distRoot,
      'client'
    )}; all positive controls hold.`
  )
} else {
  console.error(`Client-bundle guard FAILED for ${distRoot}:`)
  for (const problem of problems) {
    console.error(`  - ${problem}`)
  }
  console.error(
    'A client module reaches server-only code. Call an /api/* route instead (project-context.md, Anti-Patterns).'
  )
  process.exit(1)
}
