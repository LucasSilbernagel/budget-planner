// @vitest-environment node
/**
 * The client-bundle guard's logic (story 83.1, FR136, AC-4).
 *
 * The guard itself was shown RED on the real `31e74bf` build (it named
 * `client/assets/paddle-*.js` and all four markers) and GREEN on the fixed build:
 * see the story's Debug Log. These tests pin the rules on fixture directories,
 * above all the positive controls, because a guard that scans the wrong place
 * finds nothing and looks exactly like a pass.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEV_ONLY_SEAMS,
  SERVER_ONLY_MARKERS,
  checkClientBundle,
  checkDevSeamsAbsent,
} from '../../scripts/client-bundle-guard-lib.mjs'

const roots: string[] = []

/** A dist root with the given files (path → content). */
function dist(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'bundle-guard-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

/** A server build that contains every marker, as the real one does. */
const SERVER = { 'server/assets/db.js': SERVER_ONLY_MARKERS.join(' ') }
const CLEAN_CLIENT = { 'client/assets/index-abc.js': 'console.log("hello")' }

afterEach(() => {
  for (const root of roots.splice(0)) {
    // Undo a chmod 000 from the unreadable-directory case so the cleanup can walk it.
    try {
      chmodSync(join(root, 'client', 'locked'), 0o755)
    } catch {}
    rmSync(root, { recursive: true, force: true })
  }
})

describe('checkClientBundle', () => {
  it('passes a clean client when the server build carries every marker', () => {
    expect(checkClientBundle(dist({ ...SERVER, ...CLEAN_CLIENT }))).toEqual({
      ok: true,
      problems: [],
    })
  })

  it.each(SERVER_ONLY_MARKERS)('fails when a client file carries %s, and names it', (marker) => {
    const root = dist({
      ...SERVER,
      ...CLEAN_CLIENT,
      'client/assets/paddle-XYZ.js': `const u = process.env.${marker}`,
    })
    expect(checkClientBundle(root)).toEqual({
      ok: false,
      problems: [`server-only marker "${marker}" in client/assets/paddle-XYZ.js`],
    })
  })

  it('scans every client file, not only JavaScript', () => {
    const root = dist({ ...SERVER, ...CLEAN_CLIENT, 'client/assets/app.js.map': 'DATABASE_URL' })
    expect(checkClientBundle(root).problems).toEqual([
      'server-only marker "DATABASE_URL" in client/assets/app.js.map',
    ])
  })

  it('positive control: fails when a marker is missing from the server build', () => {
    const root = dist({ 'server/assets/db.js': 'DATABASE_URL SESSION_SECRET', ...CLEAN_CLIENT })
    const { ok, problems } = checkClientBundle(root)
    expect(ok).toBe(false)
    expect(problems).toEqual([
      expect.stringMatching(/^positive control: marker "SCRAM-SHA-256" not found in /),
      expect.stringMatching(/^positive control: marker "client_encoding" not found in /),
    ])
  })

  it('positive control: fails on a directory with no client build at all', () => {
    const { ok, problems } = checkClientBundle(dist(SERVER))
    expect(ok).toBe(false)
    expect(problems).toEqual([expect.stringMatching(/^positive control: no \.js file under /)])
  })

  it('reports a symlink instead of following it (a loop would recurse forever)', () => {
    const root = dist({ ...SERVER, ...CLEAN_CLIENT })
    symlinkSync(join(root, 'client'), join(root, 'client', 'assets', 'loop'))
    const { ok, problems } = checkClientBundle(root)
    expect(ok).toBe(false)
    expect(problems).toEqual([expect.stringMatching(/^symlink not followed: .*assets\/loop$/)])
  })

  it('reports a dangling symlink instead of throwing', () => {
    const root = dist({ ...SERVER, ...CLEAN_CLIENT })
    symlinkSync(join(root, 'nowhere'), join(root, 'client', 'assets', 'dangling.js'))
    expect(checkClientBundle(root).problems).toEqual([
      expect.stringMatching(/^symlink not followed: .*dangling\.js$/),
    ])
  })

  it.skipIf(process.getuid?.() === 0)(
    'reports an unreadable directory instead of skipping it',
    () => {
      const root = dist({ ...SERVER, ...CLEAN_CLIENT, 'client/locked/secret.js': 'DATABASE_URL' })
      chmodSync(join(root, 'client', 'locked'), 0o000)
      const { ok, problems } = checkClientBundle(root)
      expect(ok).toBe(false)
      expect(problems).toEqual([expect.stringMatching(/^cannot read directory .*locked: /)])
    }
  )
})

/**
 * Dev-only test seams must be ABSENT from the whole production build, server
 * included (story 87.1, AC 4): a production server that still carried the
 * `E2E_MAIL_OUTBOX` branch could be made to write working sign-in links to a
 * file. The positive control is the SOURCE: a marker that no longer appears in
 * its source file would make "absent from the build" vacuous.
 */
describe('checkDevSeamsAbsent (story 87.1, AC 4)', () => {
  const SEAM = { marker: 'E2E_MAIL_OUTBOX', source: 'src/mailer.ts' }
  /** An app root whose seam source carries the marker, as the real one does. */
  function app(sourceText = "if (import.meta.env.DEV && process.env['E2E_MAIL_OUTBOX']) {}") {
    return dist({ 'src/mailer.ts': sourceText })
  }

  it('the real seam list names the mail outbox, in the mailer', () => {
    expect(DEV_ONLY_SEAMS).toContainEqual({
      marker: 'E2E_MAIL_OUTBOX',
      source: 'src/server/email/mailer.ts',
    })
  })

  it('passes a build where neither client nor server carries the marker', () => {
    const root = dist({ ...SERVER, ...CLEAN_CLIENT })
    expect(checkDevSeamsAbsent(root, app(), [SEAM])).toEqual({ ok: true, problems: [] })
  })

  it.each(['server/assets/mailer-abc.js', 'client/assets/index-abc.js'])(
    'fails when %s carries the marker, and names it',
    (file) => {
      const root = dist({ ...SERVER, ...CLEAN_CLIENT, [file]: "process.env['E2E_MAIL_OUTBOX']" })
      expect(checkDevSeamsAbsent(root, app(), [SEAM])).toEqual({
        ok: false,
        problems: [`dev-only seam "E2E_MAIL_OUTBOX" in ${file}: a production build can reach it`],
      })
    }
  )

  it('positive control: fails when the source no longer carries the marker', () => {
    const root = dist({ ...SERVER, ...CLEAN_CLIENT })
    const { ok, problems } = checkDevSeamsAbsent(root, app('renamed'), [SEAM])
    expect(ok).toBe(false)
    expect(problems).toEqual([
      expect.stringMatching(
        /^positive control: marker "E2E_MAIL_OUTBOX" not found in src\/mailer\.ts/
      ),
    ])
  })

  it('positive control: fails when there is no build to scan', () => {
    const empty = dist({ 'nothing.txt': '' })
    const { ok, problems } = checkDevSeamsAbsent(empty, app(), [SEAM])
    expect(ok).toBe(false)
    expect(problems).toEqual([expect.stringMatching(/^positive control: no file under /)])
  })
})
