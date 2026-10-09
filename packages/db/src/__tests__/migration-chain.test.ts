// drizzle-kit generate diffs against the lexically last snapshot in meta/ and numbers from the
// journal, so a missing, renumbered or stray snapshot silently yields a wrong migration.

import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

type JournalEntry = {
	idx: number
	tag: string
	when: number
}

const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url))

const journal = JSON.parse(
	readFileSync(new URL('../../migrations/meta/_journal.json', import.meta.url), 'utf8')
) as { entries: JournalEntry[] }

const sqlFiles = readdirSync(migrationsDir)
	.filter((f) => f.endsWith('.sql'))
	.sort()

describe('migration chain', () => {
	it('is non-empty (guards against a wiped journal / migrations dir)', () => {
		// Without this, a deleted journal or migrations dir passes every assertion vacuously.
		expect(journal.entries.length).toBeGreaterThan(0)
		expect(sqlFiles.length).toBeGreaterThan(0)
	})

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

	it('contains no comment-only migration files (an unfilled `generate --custom`)', () => {
		// `generate --custom` writes a one-line comment placeholder, which would replay as a no-op.
		const commentOnly = sqlFiles.filter(
			(f) =>
				readFileSync(`${migrationsDir}${f}`, 'utf8')
					.split('\n')
					.filter((line) => !line.trim().startsWith('--'))
					.join('')
					.trim() === ''
		)
		expect(commentOnly, 'a migration must contain at least one SQL statement').toEqual([])
	})
})

const ROOT_SNAPSHOT_PREV_ID = '00000000-0000-0000-0000-000000000000'

type Snapshot = {
	id: string
	prevId: string
	dialect: string
	[key: string]: unknown
}

function snapshotName(idx: number): string {
	return `${String(idx).padStart(4, '0')}_snapshot.json`
}

function readJournal(dir: string): { entries: JournalEntry[] } {
	return JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as {
		entries: JournalEntry[]
	}
}

/** Takes a directory so the negative cases can run over a damaged scratch copy. */
function snapshotProblems(dir: string): string[] {
	const problems: string[] = []
	const { entries } = readJournal(dir)
	const expected = entries.map((e) => snapshotName(e.idx))

	// Exactly one snapshot per journal entry: a stray VALID snapshot sorting last is silently
	// diffed against. drizzle-kit refuses junk files itself, but exits 0.
	const listing = readdirSync(join(dir, 'meta'), { withFileTypes: true }).filter(
		(d) => d.name !== '_journal.json'
	)
	const present = new Set(listing.filter((d) => d.isFile()).map((d) => d.name))
	for (const name of expected) {
		if (!present.has(name)) problems.push(`missing snapshot: meta/${name}`)
	}
	for (const d of listing) {
		if (!d.isFile() || !expected.includes(d.name)) {
			problems.push(`unexpected entry in meta/: ${d.name}`)
		}
	}

	const seenIds = new Set<string>()
	let prev: Snapshot | undefined
	for (const [i, name] of expected.entries()) {
		if (!present.has(name)) {
			prev = undefined
			continue
		}
		let snap: Snapshot
		try {
			snap = JSON.parse(readFileSync(join(dir, 'meta', name), 'utf8')) as Snapshot
		} catch {
			problems.push(`unparseable snapshot: meta/${name}`)
			prev = undefined
			continue
		}
		if (snap.dialect !== 'postgresql') {
			problems.push(`meta/${name} has dialect ${String(snap.dialect)}, expected postgresql`)
		}
		if (seenIds.has(snap.id)) problems.push(`duplicate snapshot id ${snap.id} in meta/${name}`)
		seenIds.add(snap.id)
		const expectedPrev = i === 0 ? ROOT_SNAPSHOT_PREV_ID : prev?.id
		if (expectedPrev !== undefined && snap.prevId !== expectedPrev) {
			problems.push(
				`broken chain: meta/${name} has prevId ${
					snap.prevId
				}, expected ${expectedPrev} (the id of ${i === 0 ? 'the root' : `meta/${expected[i - 1]}`})`
			)
		}
		prev = snap
	}
	return problems
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
			a < b ? -1 : a > b ? 1 : 0
		)
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
	}
	return JSON.stringify(value)
}

/** Schema only: drops `id`, `prevId` and `_meta` (rename bookkeeping), keys sorted. */
function snapshotBody(snapshot: Snapshot): string {
	const { id: _id, prevId: _prevId, _meta: _ignored, ...body } = snapshot
	return canonical(body)
}

function readSnapshot(dir: string, idx: number): Snapshot {
	return JSON.parse(readFileSync(join(dir, 'meta', snapshotName(idx)), 'utf8')) as Snapshot
}

describe('migration snapshots', () => {
	it('has exactly one snapshot per journal entry, chained in journal order', () => {
		expect(
			snapshotProblems(migrationsDir),
			'meta/ must hold one snapshot per journal entry, chained id -> prevId, and nothing else'
		).toEqual([])
	})

	it('pins the hand-authored (custom) migrations: their snapshot repeats the previous schema', () => {
		// A generated migration can never repeat its predecessor's schema, so an equal schema means
		// hand-authored. Pinned exactly: a new custom migration must be added here on purpose.
		const copies = journal.entries
			.filter((e) => e.idx > 0)
			.filter(
				(e) =>
					snapshotBody(readSnapshot(migrationsDir, e.idx)) ===
					snapshotBody(readSnapshot(migrationsDir, e.idx - 1))
			)
			.map((e) => e.idx)
		expect(copies, 'hand-authored migrations (snapshot schema = previous schema)').toEqual([20])
	})

	it('treats a key-reordered, _meta-changed copy as the same schema (what --custom writes)', () => {
		const original = readSnapshot(migrationsDir, 20)
		const reordered = {
			...(JSON.parse(
				JSON.stringify(original, (_key, value: unknown) =>
					value !== null && typeof value === 'object' && !Array.isArray(value)
						? Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse())
						: value
				)
			) as Snapshot),
			_meta: { columns: { a: 'b' }, schemas: {}, tables: {} },
		} satisfies Snapshot
		expect(JSON.stringify(reordered), 'the reorder must actually change the bytes').not.toBe(
			JSON.stringify(original)
		)
		expect(snapshotBody(reordered), 'key order and _meta must not count as schema').toBe(
			snapshotBody(original)
		)
	})

	describe('refuses a damaged meta/ (scratch copies — the real chain is never touched)', () => {
		const scratchDirs: string[] = []
		afterAll(() => {
			for (const d of scratchDirs) rmSync(d, { recursive: true, force: true })
		})

		function scratchCopy(): string {
			const dir = mkdtempSync(join(tmpdir(), 'bp-migrations-'))
			scratchDirs.push(dir)
			cpSync(migrationsDir, dir, { recursive: true })
			// Healthy before the damage, or the case below proves nothing.
			expect(snapshotProblems(dir), 'the scratch copy must start healthy').toEqual([])
			return dir
		}

		// Derived from the journal so the cases survive the next migration.
		const newest = Math.max(...journal.entries.map((e) => e.idx))
		const beforeNewest = newest - 1

		it('has enough migrations for the cases below', () => {
			// The swap case touches `beforeNewest - 1`, so it needs three entries.
			expect(
				journal.entries.length,
				'the damage cases need >= 3 migrations'
			).toBeGreaterThanOrEqual(3)
		})

		it('a deleted newest snapshot (generate would diff against the one before it)', () => {
			const dir = scratchCopy()
			rmSync(join(dir, 'meta', snapshotName(newest)))
			expect(snapshotProblems(dir), 'deletion must be reported by name').toEqual([
				`missing snapshot: meta/${snapshotName(newest)}`,
			])
		})

		it('a renumbered snapshot', () => {
			const dir = scratchCopy()
			renameSync(
				join(dir, 'meta', snapshotName(beforeNewest)),
				join(dir, 'meta', snapshotName(newest + 1))
			)
			const problems = snapshotProblems(dir)
			expect(problems, 'the old number must be reported missing').toContain(
				`missing snapshot: meta/${snapshotName(beforeNewest)}`
			)
			expect(problems, 'the new number must be reported unexpected').toContain(
				`unexpected entry in meta/: ${snapshotName(newest + 1)}`
			)
		})

		it('a stray VALID snapshot chained onto the tail (drizzle-kit would silently use it)', () => {
			const dir = scratchCopy()
			const tail = readSnapshot(dir, newest)
			const backup = { ...tail, id: '11111111-1111-4111-8111-111111111111', prevId: tail.id }
			writeFileSync(join(dir, 'meta', 'zz-backup.json'), JSON.stringify(backup))
			expect(snapshotProblems(dir), 'a stray snapshot must be refused by name').toEqual([
				'unexpected entry in meta/: zz-backup.json',
			])
		})

		it('a directory named like the newest snapshot', () => {
			const dir = scratchCopy()
			const name = snapshotName(newest)
			rmSync(join(dir, 'meta', name))
			mkdirSync(join(dir, 'meta', name))
			expect(snapshotProblems(dir), 'a directory is not a snapshot').toEqual([
				`missing snapshot: meta/${name}`,
				`unexpected entry in meta/: ${name}`,
			])
		})

		it('an unparseable snapshot', () => {
			const dir = scratchCopy()
			const name = snapshotName(newest)
			writeFileSync(join(dir, 'meta', name), '{ not json')
			expect(snapshotProblems(dir), 'unparseable JSON must be reported by name').toEqual([
				`unparseable snapshot: meta/${name}`,
			])
		})

		it('a snapshot of the wrong dialect', () => {
			const dir = scratchCopy()
			const name = snapshotName(newest)
			writeFileSync(
				join(dir, 'meta', name),
				JSON.stringify({ ...readSnapshot(dir, newest), dialect: 'mysql' })
			)
			expect(snapshotProblems(dir), 'a wrong dialect must be reported by name').toEqual([
				`meta/${name} has dialect mysql, expected postgresql`,
			])
		})

		it('two snapshots with swapped contents (numbering intact, chain broken)', () => {
			const dir = scratchCopy()
			const aName = snapshotName(beforeNewest - 1)
			const bName = snapshotName(beforeNewest)
			const a = join(dir, 'meta', aName)
			const b = join(dir, 'meta', bName)
			const aText = readFileSync(a, 'utf8')
			writeFileSync(a, readFileSync(b, 'utf8'))
			writeFileSync(b, aText)
			const brokenAt = snapshotProblems(dir).map(
				(p) => p.match(/^broken chain: meta\/(\S+)/)?.[1] ?? p
			)
			// Swapping N-1 and N breaks three links: into N-1, into N, and into N+1.
			expect(brokenAt, 'only the chain can see a swap, and it must name each broken link').toEqual([
				aName,
				bName,
				snapshotName(newest),
			])
		})
	})
})
