// The client-bundle guard (story 83.1, FR136). PURE LIBRARY: importing this
// module reads nothing and exits nothing. The CLI is `check-client-bundle.mjs`.
// The split follows `icons-lib.mjs`, so the unit suite can drive the logic on
// fixture directories without running a check against the real build.
//
// Why a BUNDLE check and not a source rule: some client imports of `server/`
// are legitimate (`import type`, the `createServerFn` session seed, the
// constant-only `csp-nonce-key.ts`), and whether a module drags `pg` into the
// browser is decided by the bundler, not by the import line. Story 80.1
// MEASURED the failure: `routes/forecasting.tsx` loaded `server/functions/*`
// with a client-side `import()`, Vite put `pg` and the DB config into
// `dist/client/assets/paddle-*.js`, and Chromium failed to import it with
// `ReferenceError: Buffer is not defined`. Every test was green.

import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Strings only server code carries. Each was MEASURED at `31e74bf` in the
 * server-only chunk the client build wrongly contained, and in no other client
 * file: the DB and session config names, and two strings from `pg`'s own
 * protocol code (its SCRAM auth and its startup message).
 *
 * ⚠️ Each must also be present in `dist/server` (the positive control below). A
 * marker the server build stops containing would make a clean client
 * meaningless, so it fails the check instead of passing it.
 */
export const SERVER_ONLY_MARKERS = Object.freeze([
  'DATABASE_URL',
  'SESSION_SECRET',
  'SCRAM-SHA-256',
  'client_encoding',
])

/**
 * Every regular file under `dir`, recursively.
 *
 * ⚠️ Nothing is skipped silently (story 83.1 code review): a directory that cannot
 * be read, a symlink (never followed: a loop would recurse without end, and a
 * dangling one would throw) and anything that is neither a file nor a directory
 * are each reported in `problems`. A missing TOP directory is left to the
 * positive controls, which say so in their own words.
 */
function listFiles(dir, problems, isTop = true) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch (error) {
    if (!isTop) {
      problems.push(
        `cannot read directory ${dir}: ${error instanceof Error ? error.message : error}`
      )
    }
    return []
  }
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry)
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) {
      problems.push(`symlink not followed: ${path}`)
    } else if (stats.isDirectory()) {
      files.push(...listFiles(path, problems, false))
    } else if (stats.isFile()) {
      files.push(path)
    } else {
      problems.push(`not a regular file: ${path}`)
    }
  }
  return files
}

/**
 * Check a build output directory (`<distRoot>/client` and `<distRoot>/server`).
 *
 * @returns `{ ok, problems }`, where each problem is one human-readable line. `ok`
 *   is true only when every positive control holds AND no client file carries a
 *   marker.
 */
export function checkClientBundle(distRoot, markers = SERVER_ONLY_MARKERS) {
  const problems = []
  const clientDir = join(distRoot, 'client')
  const serverDir = join(distRoot, 'server')
  const clientFiles = listFiles(clientDir, problems)
  const serverFiles = listFiles(serverDir, problems)

  // Positive control 1: the client build is really here. A scan of an empty or
  // wrong directory finds nothing, which looks exactly like a pass.
  if (
    !clientFiles.some((file) => file.startsWith(join(clientDir, 'assets')) && file.endsWith('.js'))
  ) {
    problems.push(
      `positive control: no .js file under ${join(clientDir, 'assets')}; is this a build output?`
    )
  }

  // Positive control 2: every marker is a string the SERVER build contains.
  const serverBytes = serverFiles.map((file) => readFileSync(file))
  for (const marker of markers) {
    if (!serverBytes.some((bytes) => bytes.includes(marker))) {
      problems.push(`positive control: marker "${marker}" not found in ${serverDir}`)
    }
  }

  // The check: no client file (any type, not only .js) carries a marker.
  for (const file of clientFiles) {
    const bytes = readFileSync(file)
    for (const marker of markers) {
      if (bytes.includes(marker)) {
        problems.push(`server-only marker "${marker}" in ${relative(distRoot, file)}`)
      }
    }
  }

  return { ok: problems.length === 0, problems }
}
