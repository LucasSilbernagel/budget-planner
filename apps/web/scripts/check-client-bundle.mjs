// CLI for the client-bundle guard (story 83.1, FR136). Run it after a build:
//
//   pnpm --filter web build && node apps/web/scripts/check-client-bundle.mjs
//
// Exits 1 when any file in `dist/client` carries a server-only marker, when any
// file in `dist/` (client OR server) carries a dev-only seam (story 87.1, AC 4:
// the e2e mail outbox), or when a positive control fails. The logic and its
// rationale live in `client-bundle-guard-lib.mjs`. An optional argument names
// another dist root.

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEV_ONLY_SEAMS,
  SERVER_ONLY_MARKERS,
  checkClientBundle,
  checkDevSeamsAbsent,
} from './client-bundle-guard-lib.mjs'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = process.argv[2] ? resolve(process.argv[2]) : join(appRoot, 'dist')

const bundle = checkClientBundle(distRoot)
const seams = checkDevSeamsAbsent(distRoot, appRoot)

if (bundle.ok && seams.ok) {
  // `gates-lib.mjs` `parseBundleCheck` matches this line: keep its shape.
  console.log(
    `OK: no server-only marker (${SERVER_ONLY_MARKERS.join(', ')}) in ${join(
      distRoot,
      'client'
    )}, no dev-only seam (${DEV_ONLY_SEAMS.map((seam) => seam.marker).join(
      ', '
    )}) anywhere in ${distRoot}; all positive controls hold.`
  )
} else {
  console.error(`Client-bundle guard FAILED for ${distRoot}:`)
  for (const problem of [...bundle.problems, ...seams.problems]) {
    console.error(`  - ${problem}`)
  }
  if (!bundle.ok) {
    console.error(
      'A client module reaches server-only code. Call an /api/* route instead (project-context.md, Anti-Patterns).'
    )
  }
  if (!seams.ok) {
    console.error(
      'A dev-only test seam survived a production build. Gate it on `import.meta.env.DEV` FIRST (see the seam guard tests).'
    )
  }
  process.exit(1)
}
