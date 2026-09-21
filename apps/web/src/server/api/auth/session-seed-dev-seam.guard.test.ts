/**
 * The dev-only session-seed override is structurally incapable of reaching
 * production (story 58.1, D2, AC-9).
 *
 * ## Why the seam exists
 *
 * Story 58.1 makes `GlobalNav` tier-aware: a paid session gets four extra
 * destinations. Proving that at real viewport widths needs Playwright, and
 * Playwright could not render a paid session at all — `playwright.config.ts`
 * boots `pnpm dev` with no database and no auth fixture, so `getSessionSeed`
 * always resolved the signed-out seed and `page.goto('/')` always painted the
 * FREE nav. Every "paid nav" geometry assertion would have been measuring the
 * free nav while passing.
 *
 * The nav's paid branch reads NOTHING but the seed — no DB row, no premium page
 * data — so a single override at the point the seed is produced makes the
 * measurement real. That is the whole justification, and it is narrow on
 * purpose.
 *
 * ## Why a guard rather than trusting the gate
 *
 * This is a code path that fabricates an authenticated, entitled session from an
 * environment variable. It is exactly the kind of test convenience that becomes a
 * production auth bypass the moment someone "simplifies" the condition — dropping
 * `import.meta.env.DEV` leaves a backdoor that any host setting `E2E_SESSION_SEED`
 * can walk through, and nothing else in the suite would notice.
 *
 * The gate must therefore be STRUCTURAL, not merely runtime:
 *
 *   - `import.meta.env.DEV` is replaced by Vite with a literal at build time, so
 *     in a production build the condition becomes `false && …` and the whole
 *     branch — including the `E2E_SESSION_SEED` string — is eliminated. The
 *     override is ABSENT from the bundle, not just unreachable.
 *   - `import.meta.env.DEV` is written FIRST so short-circuit evaluation means a
 *     production runtime never even reads the variable.
 *
 * ⚠️ This file asserts the SOURCE SHAPE. It cannot, on its own, prove what a
 * production bundle contains. That was verified once by measurement — building
 * `apps/web` and grepping `dist/` for `E2E_SESSION_SEED` — and the result is
 * recorded in story 58.1's Dev Agent Record. Re-run that grep if this gate is
 * ever restructured; a source-shape assertion is a tripwire, not a proof.
 *
 * ⚠️ The seam grants a SEED ONLY. It never mints a signed cookie, never creates a
 * DB user, and never makes a server-side request authenticated. A premium PAGE
 * still renders its locked state under it, because that data comes from the
 * database. It is not, and must never be documented as, a way to sign in.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SESSION_SEED = join(__dirname, 'session-seed.ts')
const source = (): string => readFileSync(SESSION_SEED, 'utf8')

const ENV_KEY = 'E2E_SESSION_SEED'

describe('getSessionSeed dev-only override (story 58.1, AC-9)', () => {
  it('gates the override on the DEV build, with the build flag evaluated FIRST', () => {
    // Pinned as one contiguous expression rather than "both strings appear
    // somewhere": `import.meta.env.DEV` on one line and the env read fifty lines
    // below would satisfy a two-substring check while being an ungated backdoor.
    expect(source()).toContain(`import.meta.env.DEV && process.env['${ENV_KEY}']`)
  })

  it('opens the gate with NOTHING but that expression — no disjunction, no escape hatch', () => {
    // ⚠️ The substring pin above is necessary and NOT sufficient, and code review
    // proved it: `if (true || import.meta.env.DEV && process.env[…])` contains the
    // pinned text verbatim, keeps the occurrence count at 2, and trips no
    // NODE_ENV regex — a one-token backdoor that every other test here waves
    // through. Anchoring on the WHOLE condition is what closes that.
    const conditions = [...source().matchAll(/if \(([^)]*\)?[^{]*?)\) \{/g)].map((m) => m[1].trim())
    const gate = conditions.filter((c) => c.includes(ENV_KEY))

    expect(gate, `expected exactly one condition mentioning ${ENV_KEY}`).toHaveLength(1)
    // Exact, not "starts with" — a trailing `|| somethingElse` must fail.
    expect(gate[0]).toBe(`import.meta.env.DEV && process.env['${ENV_KEY}']`)
  })

  it('reads the override variable NOWHERE outside that single gated branch', () => {
    // ⚠️ Counts actual ENV READS (`process.env['E2E_SESSION_SEED']`), not bare
    // mentions of the name. The first version counted mentions and went red the
    // moment diagnostics naming the variable were added — punishing the error
    // messages while saying nothing about reachability, which is the thing that
    // matters here.
    const reads = source().split(`process.env['${ENV_KEY}']`).length - 1

    // Exactly two: the guard condition and the parse beside it. A third read is
    // either a second code path or a re-introduction somewhere the DEV gate does
    // not reach — both are the failure this guard exists to catch.
    expect(reads, `expected exactly 2 reads of ${ENV_KEY} (guard + parse), found ${reads}`).toBe(2)
  })

  it('never widens the gate to a runtime-only environment check', () => {
    const text = source()

    // `NODE_ENV`/`MODE` comparisons are the tempting "equivalent" rewrite and are
    // NOT equivalent: they are runtime strings, so the branch and its literal
    // survive into the production bundle and a mis-set variable re-opens it.
    // Only the build-time-replaced flag gets the branch deleted.
    //
    // ⚠️ Matches ANY NODE_ENV comparison, not just `=== 'production'`. The first
    // version of this guard pinned the production literal alone, so the obvious
    // rewrite — `NODE_ENV === 'development'` — sailed straight through it.
    expect(text).not.toMatch(/NODE_ENV\s*[!=]==?\s*['"]/)
    expect(text).not.toMatch(/import\.meta\.env\.MODE/)
  })

  it('records why the seam exists, at the seam', () => {
    // Anchored on the distinguishing claim, not on a word like "dev" that any
    // nearby comment would contain.
    expect(source()).toContain('story 58.1')
    expect(source()).toMatch(/never a signed cookie|seed only|not a way to sign in/i)
  })
})
