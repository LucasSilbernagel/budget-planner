import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AC-4 regression guard (stories 6-3 / UX-DR11 and 6-8 / UX-DR14).
 *
 * Destructive "Are you sure?" confirmations must use the themed ConfirmDialog,
 * never a browser `confirm()`/`window.confirm()`, and form-validation feedback
 * must use themed inline field-level errors, never a browser `alert()`. This
 * walks the web source and fails if any non-comment `confirm(` or `alert(` call
 * survives — so the criteria are enforced on every run, not just a one-time grep
 * at implementation time.
 *
 * (Story 6-8 removed the earlier exclusion that left validation `alert()` out of
 * scope; both browser popups are now forbidden.)
 */

const SRC_ROOT = resolve(__dirname, '../..')

/** Recursively collect .ts/.tsx source files, excluding tests and generated code. */
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
      // `\bconfirm\s*\(` matches the global `confirm(` and `window.confirm(`
      // (boundary after the dot), but not `onConfirm(`/`confirmDelete(` (capital
      // or trailing letters) nor the `delete-confirm-*` testids.
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
      // `\balert\s*\(` matches the global `alert(` and `window.alert(` (boundary
      // after the dot), but not `role="alertdialog"` (no `(` follows) nor
      // identifiers like `alertMessage`. Known limitation (carried from 6-3):
      // aliasing / bracket-access can bypass this defense-in-depth grep; an AST
      // check is overkill here.
      if (/\balert\s*\(/.test(code)) {
        offenders.push(file.replace(SRC_ROOT, 'src'))
      }
    }
    expect(offenders).toEqual([])
  })
})
