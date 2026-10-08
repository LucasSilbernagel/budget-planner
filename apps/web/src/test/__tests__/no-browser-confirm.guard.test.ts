import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = resolve(__dirname, '../..')

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			if (entry === '__tests__' || entry === 'node_modules') continue
			collectSourceFiles(full, acc)
			continue
		}
		if (!/\.(ts|tsx)$/.test(entry)) continue
		if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue
		if (entry.endsWith('.gen.ts')) continue
		acc.push(full)
	}
	return acc
}

/** Strip block and line comments so doc references to `confirm()` don't trip the guard. */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('AC-4 guard: no browser confirm() in destructive flows', () => {
	it('finds no surviving confirm()/window.confirm() call in web source', () => {
		const offenders: string[] = []
		for (const file of collectSourceFiles(SRC_ROOT)) {
			const code = stripComments(readFileSync(file, 'utf8'))
			// Boundary after the dot matches `window.confirm(`; not `onConfirm(` or `delete-confirm-*` testids.
			if (/\bconfirm\s*\(/.test(code)) {
				offenders.push(file.replace(SRC_ROOT, 'src'))
			}
		}
		expect(offenders).toEqual([])
	})
})

describe('AC-4 guard: no browser alert() in form validation (story 6-8)', () => {
	it('finds no surviving alert()/window.alert() call in web source', () => {
		const offenders: string[] = []
		for (const file of collectSourceFiles(SRC_ROOT)) {
			const code = stripComments(readFileSync(file, 'utf8'))
			// Not `role="alertdialog"` or `alertMessage`. Aliasing or bracket access can bypass this grep.
			if (/\balert\s*\(/.test(code)) {
				offenders.push(file.replace(SRC_ROOT, 'src'))
			}
		}
		expect(offenders).toEqual([])
	})
})
