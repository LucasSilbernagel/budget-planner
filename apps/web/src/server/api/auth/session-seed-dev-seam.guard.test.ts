// A source-shape tripwire only; the production proof is the client-bundle guard's build scan.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SESSION_SEED = join(__dirname, 'session-seed.ts')
const source = (): string => readFileSync(SESSION_SEED, 'utf8')

const ENV_KEY = 'E2E_SESSION_SEED'

describe('getSessionSeed dev-only override (story 58.1, AC-9)', () => {
  it('gates the override on the DEV build, with the build flag evaluated FIRST', () => {
    // One contiguous expression: two substrings far apart would pass while ungated.
    expect(source()).toContain(`import.meta.env.DEV && process.env['${ENV_KEY}']`)
  })

  it('opens the gate with NOTHING but that expression — no disjunction, no escape hatch', () => {
    // `if (true || import.meta.env.DEV && …)` contains the pinned text, so anchor on the whole condition.
    const conditions = [...source().matchAll(/if \(([^)]*\)?[^{]*?)\) \{/g)].map((m) => m[1].trim())
    const gate = conditions.filter((c) => c.includes(ENV_KEY))

    expect(gate, `expected exactly one condition mentioning ${ENV_KEY}`).toHaveLength(1)
    expect(gate[0]).toBe(`import.meta.env.DEV && process.env['${ENV_KEY}']`)
  })

  it('reads the override variable NOWHERE outside that single gated branch', () => {
    // Counts env reads, not mentions, so diagnostics naming the variable stay allowed.
    const reads = source().split(`process.env['${ENV_KEY}']`).length - 1

    expect(reads, `expected exactly 2 reads of ${ENV_KEY} (guard + parse), found ${reads}`).toBe(2)
  })

  it('never widens the gate to a runtime-only environment check', () => {
    const text = source()

    // Only import.meta.env.DEV elimination is Vite's documented contract; a NODE_ENV gate relies on
    // the build inlining it or the runtime variable being set right.
    expect(text).not.toMatch(/NODE_ENV\s*[!=]==?\s*['"]/)
    expect(text).not.toMatch(/import\.meta\.env\.MODE/)
  })
})
