// `drizzle-kit push`-built databases have the schema but no journal; replaying migrations would
// re-mint ids or half-migrate. Fail closed on anything not provably safe.

export interface DbShape {
  hasJournalTable: boolean
  journalRowCount: number
  userTableCount: number
}

/** `inconsistent`: the journal and the schema disagree, in either direction. */
type DbProvenance = 'empty' | 'journaled' | 'push-built' | 'inconsistent' | 'unreadable'

export interface MigrateVerdict {
  safe: boolean
  provenance: DbProvenance
  reason: string
}

function isSaneCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0
}

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
    // A journal with history over no tables (a bad rollback or restore) would make migrate skip
    // everything and leave an empty database.
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
