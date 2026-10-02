/**
 * The dev-only mail outbox is structurally incapable of reaching production
 * (story 87.1, decision D2, AC 4), to the bar story 58.1 set for the
 * `E2E_SESSION_SEED` seam (`server/api/auth/session-seed-dev-seam.guard.test.ts`).
 *
 * ## Why the seam exists
 *
 * Flow F9 signs in for real, and the one step a test cannot do for real is read
 * the email: the token is stored HASHED (`login-token.ts`), so it cannot be read
 * back from the database either. `sendMagicLinkEmail`'s no-key development
 * branch already logs the link without calling Brevo; with `E2E_MAIL_OUTBOX`
 * set it ALSO appends `{ to, link }` to that file, which the spec reads.
 *
 * ## Why a guard
 *
 * A file that collects working sign-in links is an account-takeover channel on
 * any host that can read it. So the gate must be the build-time literal
 * `import.meta.env.DEV`, evaluated first: a production build turns the
 * condition into `false && …` and the bundler deletes the branch, the variable
 * name and the `node:fs/promises` import with it.
 *
 * ⚠️ This file pins the SOURCE SHAPE (a tripwire). The PROOF is against the real
 * build: `scripts/check-client-bundle.mjs` (phase A of `pnpm gates`, and CI's
 * build step) fails if `E2E_MAIL_OUTBOX` appears anywhere in `dist/client` or
 * `dist/server` (`DEV_ONLY_SEAMS` in `client-bundle-guard-lib.mjs`).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MAILER = join(__dirname, 'mailer.ts')
const source = (): string => readFileSync(MAILER, 'utf8')

const ENV_KEY = 'E2E_MAIL_OUTBOX'
const GATE = `import.meta.env.DEV && process.env['${ENV_KEY}']`

describe('sendMagicLinkEmail dev-only outbox (story 87.1, AC 4)', () => {
  it('opens the outbox with NOTHING but the DEV build flag, evaluated first', () => {
    // The whole condition, exactly: `true || import.meta.env.DEV && …` contains
    // the gate verbatim and would pass a substring check (58.1's review).
    const conditions = [...source().matchAll(/if \(([^)]*\)?[^{]*?)\) \{/g)].map((m) =>
      (m[1] ?? '').trim()
    )
    const gate = conditions.filter((c) => c.includes(ENV_KEY))
    expect(gate, `expected exactly one condition mentioning ${ENV_KEY}`).toHaveLength(1)
    expect(gate[0]).toBe(GATE)
  })

  it('reads the variable nowhere outside that branch (the gate and the write)', () => {
    const reads = source().split(`process.env['${ENV_KEY}']`).length - 1
    expect(reads, `expected exactly 2 reads of ${ENV_KEY}, found ${reads}`).toBe(2)
  })

  it('imports the file system only inside the gated branch', () => {
    const text = source()
    // A static import survives a production build even when its only caller
    // is deleted; the dynamic one inside the branch goes with it.
    expect(text).not.toMatch(/^import .*['"](node:)?fs(\/promises)?['"]/m)
    const imports = text.split("import('node:fs/promises')").length - 1
    expect(imports, 'expected exactly one dynamic fs import').toBe(1)
    const gate = text.indexOf(`if (${GATE}) {`)
    const fsImport = text.indexOf("import('node:fs/promises')")
    const branchEnd = text.indexOf('return undefined', gate)
    expect(gate).toBeGreaterThan(0)
    expect(fsImport).toBeGreaterThan(gate)
    expect(fsImport).toBeLessThan(branchEnd)
  })

  it('never widens the gate to a runtime environment check', () => {
    // The surrounding branch already tests NODE_ENV === 'development' (a
    // runtime string). The outbox must not rely on it: pin that the ONLY
    // condition naming the variable is the build-time one (first test), and
    // that no `import.meta.env.MODE` rewrite crept in.
    expect(source()).not.toMatch(/import\.meta\.env\.MODE/)
  })

  it('records why the seam exists, at the seam', () => {
    expect(source()).toMatch(/story 87\.1/i)
  })
})
