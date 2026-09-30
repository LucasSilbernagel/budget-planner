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
import { SERVER_ONLY_MARKERS, checkClientBundle } from '../../scripts/client-bundle-guard-lib.mjs'

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
