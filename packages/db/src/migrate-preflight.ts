/**
 * Migration preflight guard (Story 5-4, AC-4).
 *
 * `drizzle-kit migrate` is only safe against a database whose history it owns.
 * The reconciliation risk this guard exists for is recorded in
 * `_bmad-output/implementation-artifacts/deferred-work.md` (the 5-14 review):
 * the existing DanubeData dev databases were built with `drizzle-kit push`, so
 * they carry the schema but NO `drizzle.__drizzle_migrations` journal rows.
 * Replaying `0000 -> …` against one of those re-mints `userProfiles` ids and
 * orphans `profileId` / `forecastingProfiles` references, or simply fails
 * partway — a half-migrated database.
 *
 * So the deploy pipeline classifies the target BEFORE it migrates, and refuses
 * anything it cannot prove is either a clean slate or a journal-tracked DB.
 * Fail-closed: an unrecognised or unreadable shape is UNSAFE, never "probably
 * fine". Resolving a push-built database is Story 4-17's decision, not a flag
 * this guard should offer.
 */

/** What the preflight query observed about the target database. */
export interface DbShape {
  /** Does `drizzle.__drizzle_migrations` exist? */
  hasJournalTable: boolean
  /** Rows in that journal (0 when the table exists but nothing was applied). */
  journalRowCount: number
  /** BASE TABLEs in the `public` schema — i.e. is there a schema already? */
  userTableCount: number
}

/**
 * How the target database was built, as far as the journal can tell.
 *
 * - `empty` — no schema yet: a genuine clean slate, safe to migrate from 0000.
 * - `journaled` — drizzle owns the history; `migrate` applies only what is new.
 * - `push-built` — schema present, no journal: the deferred-work:643 hazard.
 * - `inconsistent` — the journal and the schema disagree in EITHER direction:
 *   a journal with no rows over an existing schema, or a journal with history
 *   over a database that has no tables at all.
 * - `unreadable` — the probe returned values that cannot be trusted.
 */
export type DbProvenance = 'empty' | 'journaled' | 'push-built' | 'inconsistent' | 'unreadable'

export interface MigrateVerdict {
  safe: boolean
  provenance: DbProvenance
  /** Operator-facing explanation, printed by the CLI on both paths. */
  reason: string
}

/** A count is only believable if it is a non-negative integer. */
function isSaneCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0
}

/**
 * Decide whether `drizzle-kit migrate` may run against this database.
 *
 * Pure: the CLI does the querying, this does the deciding, so every branch is
 * unit-testable without a live PostgreSQL.
 */
export function assessMigrateSafety(shape: DbShape): MigrateVerdict {
  const { hasJournalTable, journalRowCount, userTableCount } = shape

  if (!isSaneCount(journalRowCount) || !isSaneCount(userTableCount)) {
    return {
      safe: false,
      provenance: 'unreadable',
      reason:
        'The preflight probe returned counts that are not non-negative integers, so the ' +
        'database shape could not be established. Refusing to migrate on an unreadable target.',
    }
  }

  if (hasJournalTable && journalRowCount > 0) {
    // A journal with history is only trustworthy if the schema it describes is
    // actually THERE. Code review 2026-09-03 found this branch waving through
    // `{journalRows: 5, tables: 0}` — a database whose schema was dropped but
    // whose drizzle journal survived (a bad rollback, a restore that missed the
    // public schema). `migrate` would read the journal, conclude every migration
    // was already applied, skip all of them, and leave an EMPTY database the app
    // cannot use. That is the exact mirror of the `inconsistent` case below, and
    // it must fail closed the same way.
    if (userTableCount === 0) {
      return {
        safe: false,
        provenance: 'inconsistent',
        reason: `The drizzle journal claims ${journalRowCount} migration(s) have been applied, but the database has NO tables. drizzle would skip the whole chain as "already applied" and leave an empty database. The schema was probably dropped or a restore missed it — investigate before deploying.`,
      }
    }
    return {
      safe: true,
      provenance: 'journaled',
      reason: `drizzle owns this database's history (${journalRowCount} journal row(s) in drizzle.__drizzle_migrations, over ${userTableCount} table(s)). Only unapplied migrations will run.`,
    }
  }

  if (userTableCount === 0) {
    return {
      safe: true,
      provenance: 'empty',
      reason:
        'No BASE TABLEs in the public schema — a genuine clean slate. The full ' +
        'migration chain will be applied from 0000 and the journal created.',
    }
  }

  if (!hasJournalTable) {
    return {
      safe: false,
      provenance: 'push-built',
      reason: `This database already has ${userTableCount} table(s) in the public schema but NO drizzle.__drizzle_migrations journal — the signature of a \`drizzle-kit push\`-built database. Replaying the chain here would re-mint userProfiles ids and orphan profileId / forecastingProfiles references, or fail half-way. Resolve the baseline/squash strategy under Story 4-17 before this database can be a migrate target.`,
    }
  }

  return {
    safe: false,
    provenance: 'inconsistent',
    reason: `The drizzle journal table exists but is EMPTY, while the public schema already has ${userTableCount} table(s). drizzle's view of this database disagrees with its actual schema, so the migration chain cannot be replayed safely. Investigate before deploying.`,
  }
}
