// A bundle check, not a source rule: whether a module drags `pg` into the browser is
// decided by the bundler, and some client imports of server/ are legitimate.

import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Each must also appear in dist/server (positive control): a marker the server build
 * stops containing would make a clean client meaningless.
 */
export const SERVER_ONLY_MARKERS = Object.freeze([
  'DATABASE_URL',
  'SESSION_SECRET',
  'SCRAM-SHA-256',
  'client_encoding',
])

/**
 * Nothing is skipped silently: unreadable dirs, symlinks (never followed) and special
 * files are each reported in `problems`.
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

export function checkClientBundle(distRoot, markers = SERVER_ONLY_MARKERS) {
  const problems = []
  const clientDir = join(distRoot, 'client')
  const serverDir = join(distRoot, 'server')
  const clientFiles = listFiles(clientDir, problems)
  const serverFiles = listFiles(serverDir, problems)

  // Positive control: a scan of an empty or wrong directory looks exactly like a pass.
  if (
    !clientFiles.some((file) => file.startsWith(join(clientDir, 'assets')) && file.endsWith('.js'))
  ) {
    problems.push(
      `positive control: no .js file under ${join(clientDir, 'assets')}; is this a build output?`
    )
  }

  const serverBytes = serverFiles.map((file) => readFileSync(file))
  for (const marker of markers) {
    if (!serverBytes.some((bytes) => bytes.includes(marker))) {
      problems.push(`positive control: marker "${marker}" not found in ${serverDir}`)
    }
  }

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

/**
 * Gated on the build-time `import.meta.env.DEV` literal, so a production build drops the
 * name; `source` is the positive control that the marker still exists in source.
 */
export const DEV_ONLY_SEAMS = Object.freeze([
  Object.freeze({ marker: 'E2E_MAIL_OUTBOX', source: 'src/server/email/mailer.ts' }),
  Object.freeze({ marker: 'E2E_SESSION_SEED', source: 'src/server/api/auth/session-seed.ts' }),
])

export function checkDevSeamsAbsent(distRoot, appRoot, seams = DEV_ONLY_SEAMS) {
  const problems = []
  for (const { marker, source } of seams) {
    let text = ''
    try {
      text = readFileSync(join(appRoot, source), 'utf8')
    } catch (error) {
      problems.push(
        `positive control: cannot read ${source}: ${error instanceof Error ? error.message : error}`
      )
      continue
    }
    if (!text.includes(marker)) {
      problems.push(
        `positive control: marker "${marker}" not found in ${source}; its absence from the build would prove nothing`
      )
    }
  }

  const files = [
    ...listFiles(join(distRoot, 'client'), problems),
    ...listFiles(join(distRoot, 'server'), problems),
  ]
  if (files.length === 0) {
    problems.push(`positive control: no file under ${distRoot}/client or ${distRoot}/server`)
  }
  for (const file of files) {
    const bytes = readFileSync(file)
    for (const { marker } of seams) {
      if (bytes.includes(marker)) {
        problems.push(
          `dev-only seam "${marker}" in ${relative(
            distRoot,
            file
          )}: a production build can reach it`
        )
      }
    }
  }

  return { ok: problems.length === 0, problems }
}
