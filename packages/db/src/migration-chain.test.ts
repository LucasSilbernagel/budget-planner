/**
 * Migration-chain integrity (Story 4.17, AC-4).
 *
 * The production instance is migrated from a clean slate by replaying every
 * journal entry in order, so the chain being internally consistent is a
 * precondition for that replay — and unlike the live run, it can be proven here
 * without a database. `drizzle-kit migrate` reads `meta/_journal.json` and then
 * looks for `<tag>.sql`: a journal entry with no file, or a gap in the sequence,
 * fails mid-migration against production rather than in CI.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface JournalEntry {
  idx: number
  tag: string
  when: number
}

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url))

const journal = JSON.parse(
  readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')
) as { entries: JournalEntry[] }

const sqlFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

describe('migration chain', () => {
  it('has a .sql file for every journal entry', () => {
    const missing = journal.entries.filter((e) => !sqlFiles.includes(`${e.tag}.sql`))
    expect(missing.map((e) => e.tag)).toEqual([])
  })

  it('has a journal entry for every .sql file (no unregistered migration)', () => {
    const tags = new Set(journal.entries.map((e) => e.tag))
    const orphans = sqlFiles.filter((f) => !tags.has(f.replace(/\.sql$/, '')))
    expect(orphans).toEqual([])
  })

  it('is contiguous and ordered from idx 0', () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i))
  })

  it('orders entries by ascending timestamp, matching the tag prefixes', () => {
    const whens = journal.entries.map((e) => e.when)
    expect(whens).toEqual([...whens].sort((a, b) => a - b))

    const prefixes = journal.entries.map((e) => Number(e.tag.slice(0, 4)))
    expect(prefixes).toEqual(journal.entries.map((e) => e.idx))
  })

  it('contains no empty migration files', () => {
    const empties = sqlFiles.filter(
      (f) => readFileSync(`${migrationsDir}${f}`, 'utf8').trim() === ''
    )
    expect(empties).toEqual([])
  })
})
