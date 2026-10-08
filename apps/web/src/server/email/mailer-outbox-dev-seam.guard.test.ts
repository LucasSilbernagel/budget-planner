/** Pins the source shape only; the real proof is the bundle check on dist/. */

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
		// the gate verbatim and would pass a substring check.
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
		// The outbox must not rely on the surrounding runtime NODE_ENV check.
		expect(source()).not.toMatch(/import\.meta\.env\.MODE/)
	})
})
