// @vitest-environment node
// Opt out of the jsdom environment the components/** glob would assign.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// A source guard because Recharts lays out nothing in jsdom. Rows report CLOSING balances,
// so row 0 is not the starting net worth.
describe('ProjectionChart — "Starting" reference line', () => {
	const source = readFileSync(join(__dirname, '..', 'projection-chart.tsx'), 'utf8')

	const codeLines = (() => {
		const out: string[] = []
		let inBlock = false
		for (const raw of source.split('\n')) {
			let line = ''
			let i = 0
			while (i < raw.length) {
				if (inBlock) {
					const end = raw.indexOf('*/', i)
					if (end === -1) {
						i = raw.length
					} else {
						inBlock = false
						i = end + 2
					}
					continue
				}
				if (raw.startsWith('/*', i)) {
					inBlock = true
					i += 2
					continue
				}
				if (raw.startsWith('//', i)) break
				line += raw[i]
				i += 1
			}
			out.push(line)
		}
		return out
	})()

	const code = codeLines.join('\n')

	it('binds the reference line to summary.startingNetWorth', () => {
		expect(code).toContain('ReferenceLine')
		expect(code).toMatch(/result\?\.summary\.startingNetWorth/)
	})

	it('never derives the starting figure from a projection row', () => {
		expect(code).not.toMatch(/chartData\[0\]/)
		expect(code).not.toMatch(/projection\[0\]/)
		expect(code).not.toMatch(/baseline\[0\]/)
	})
})
