/**
 * The per-user lock on the SET OF LIVE PROFILES (story 76.3, FR122), shared by
 * every server writer that depends on it: the sync push (`sync.ts`), since
 * story 80.1 (FR131) the forecast save (`server/functions/forecastingProfiles.ts`),
 * and since story 80.2 (FR130(2)) the default-profile provisioning
 * (`server/functions/profiles.ts`, `createDefaultProfileForUser`).
 *
 * One module, one copy: a second copy would let the lock order drift between
 * the two callers, which is exactly what the audit below exists to prevent.
 */

import { db, users } from '@budget-planner/db'
import { eq } from 'drizzle-orm'

/** The handle a `db.transaction` callback receives. */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Lock the requesting user's `users` row: the ONE lock every server
 * transaction that depends on the SET OF LIVE PROFILES takes, as its FIRST
 * statement (story 76.3, FR122; extended beyond the sync push by story 80.1,
 * FR131).
 *
 * - WRITERS of the set take `'no key update'`: in `sync.ts`,
 *   `deleteProfileWithChildren` (the last-profile count), `promoteProfile`,
 *   `ensureUserHasDefaultProfile` (the default seat) and, since story 80.2,
 *   `createUserProfile` (a profile create, and its seat check); in
 *   `server/functions/profiles.ts`, `createDefaultProfileForUser` (its slow path
 *   only: a user with a live profile takes a lock-free read and returns).
 * - A row CREATED under a profile takes `'share'`, then re-checks that its
 *   profile is live, then inserts: `createProfileScopedEntity` in `sync.ts`, and
 *   `createForecastingProfile` in `server/functions/forecastingProfiles.ts`.
 *
 * Only after this lock are `userProfiles` rows, then child rows, touched.
 *
 * ## Why the `users` row
 *
 * It is ONE row per user, it exists for every authenticated push, and it is
 * the row account erasure already locks first (`eraseAccountRows` in
 * `server/api/account.ts`). So every path shares one first lock, in one order.
 * Locking "the user's live `userProfiles` rows" instead would lock a SET whose
 * membership is the thing being raced (a row created after the lock is not
 * covered), and `promoteProfile` touches the default row and its target in a
 * data-dependent order, which could form a cycle with a cascade that locked
 * profiles by id.
 *
 * ## Why these strengths
 *
 * - `FOR NO KEY UPDATE` for writers, NOT `FOR UPDATE`: every child INSERT's
 *   foreign-key check on `userId -> users.id` takes `FOR KEY SHARE` on this row.
 *   `FOR UPDATE` conflicts with `KEY SHARE`, so it would stall every other push
 *   of the user that inserts a row. `NO KEY UPDATE` does not conflict with
 *   `KEY SHARE`, and does conflict with itself and with `SHARE`: exactly the
 *   writer/writer and writer/reader exclusion wanted.
 * - `FOR SHARE` for the child create: creates do not block each other, but they
 *   wait for (and are waited on by) any writer of the profile set. Under READ
 *   COMMITTED every statement takes a fresh snapshot, so the liveness re-check
 *   that runs AFTER this lock is granted sees a cascade that committed while it
 *   waited. That is why the re-check is a separate statement after the lock.
 *
 * ## ⚠️ No deadlock with the existing contenders (REASONED from the source and
 * the PostgreSQL row-lock matrix, NOT measured: PGlite is one connection, so no
 * test here can make two transactions wait on each other)
 *
 * Audited 2026-09-28 at `65d6ce1`, BEFORE story 76.3, by grepping `apps/web/src`
 * (tests excluded) for `.transaction(` (6 sites; 76.3 added 2 more, both
 * taking this lock first) and `.update(users)` (10 sites). Re-grepped
 * 2026-09-29 at `9144e0a`, before story 80.1: 8 `.transaction(` sites, the
 * same 8 (four in `sync.ts`, plus `paddle.ts`, `sweep.ts`, `account.ts` and
 * `profiles.ts:deleteProfile`); 80.1 adds a 9th (the forecast save), which
 * takes this lock first. Re-grepped 2026-09-29 at `2497ce4`, for story 80.2:
 * the same 9, and 80.2 adds two (the sync profile create in `sync.ts`,
 * `createDefaultProfileForUser` in `profiles.ts`), 11 in all, both taking this
 * lock first. A point-in-time measurement: a new transaction must be checked
 * against this table. Story 93.1 deleted `profiles.ts:deleteProfile` (no
 * production caller); re-grepped 2026-10-04 at `59b06e8` + 93.1: 10 sites
 * (five in `sync.ts`, `paddle.ts`, `sweep.ts`, `account.ts`,
 * `profiles.ts:createDefaultProfileForUser`, `forecastingProfiles.ts`).
 *
 * | Contender | Its first lock | Conflicts with ours? | Why no cycle |
 * |---|---|---|---|
 * | Account erasure (`account.ts`, `eraseAccountRows`) | `users` `FOR UPDATE` | yes, both strengths | Same first row, so the two serialize before either touches another row. This also closes a latent cycle: erasure deletes `forecastingProfiles` FIRST while the cascade reaches it LAST, and two transactions taking child-row locks in different orders could deadlock. |
 * | Retention purge (`retention/sweep.ts`) | `users` `FOR UPDATE SKIP LOCKED` | yes | It SKIPS a row we hold; if it holds the row first, we wait while holding nothing. |
 * | Rate-limit reaper (`rate-limit/db-window.ts`) | `rateLimits` rows, `SKIP LOCKED` | no shared row | No edge in the wait-for graph. |
 * | `checkRateLimit` upsert | one `rateLimits` row, autocommit | no shared row | It commits before any op transaction in `processBatchSync` opens. |
 * | Paddle webhook (`routes/api/webhooks/paddle.ts`, `runGuarded`) | the event-claim row, then `users` rows | yes, on `users` | It touches NO `userProfiles` or child rows inside its transaction (`ensureDefaultProfile` runs after it commits), so it never holds a lock we wait for after our first statement. |
 * | Autocommit `users` updates (`auth/paddle.ts`, `retention/sweep.ts` notices) | one `users` row, one statement | yes | Single-statement: they hold nothing while waiting. |
 * | ~~`server/functions/profiles.ts:deleteProfile`~~ | (deleted) | (deleted) | DELETED by story 93.1 (it had zero production callers, story 63.2). The live deletion path is the store -> the sync push (`deleteProfileWithChildren` above). A new non-sync deletion path must take this lock first. |
 * | Forecast save (`server/functions/forecastingProfiles.ts`, `createForecastingProfile`, story 80.1) | `users` `FOR SHARE` (this lock) | with the writers above | Same first row as every writer, then a `userProfiles` read, then `forecastingProfiles` rows. The cascade hard-deletes those same `forecastingProfiles` rows only after taking `NO KEY UPDATE` on `users`, so the two serialize on the first row before either touches a forecast. ⚠️ Two saves do NOT serialize: `FOR SHARE` does not conflict with itself, so two concurrent DEFAULT saves of one profile can both commit as default (each demotion's snapshot misses the other's insert; there is no partial unique index on `isDefault`). No deadlock, but not exclusive either: recorded in `deferred-work.md` (code review of 80-1). |
 * | Default-profile provisioning (`server/functions/profiles.ts`, `createDefaultProfileForUser`, story 80.2; the pull backfill `routes/api/sync/changes.ts` and the webhook's `ensureDefaultProfile`) | `users` `NO KEY UPDATE` (this lock), only on the slow path | yes, like every writer | Same first row, then a `userProfiles` read, a `users` currency read and one `userProfiles` insert; no child row. The webhook calls it AFTER its own transaction commits, never inside it, so it never holds the event-claim row or a `users` row while waiting here. The lock-free fast path is one autocommit SELECT and holds nothing. |
 * | Sync profile create (`sync.ts`, `createUserProfile`, story 80.2) | `users` `NO KEY UPDATE` (this lock) | yes, like every writer | The same first lock as the other sync writers, then `userProfiles` reads and one insert; no child row is touched before or after. |
 * | Sync single-statement child writers (`updateEntity`, `deleteEntity`) | one child row, autocommit, NO `users` lock | with the cascade's child rows | NOT covered by this lock. A cycle is possible through a unique index: a category rename to the name of a row the cascade has just tombstoned waits on the cascade's index entry while holding its own row, which the cascade's sweep wants. PostgreSQL aborts one side with `40P01`, which is transient and kept queued; no data is lost. |
 *
 * ⚠️ Costs, accepted:
 * - A lock WAIT is not an error and has no bound: the pool sets no
 *   `lock_timeout` or `statement_timeout` (`packages/db/src/client.ts`), so a
 *   waiting request holds a pool connection until the holder commits. Every
 *   holder above is short and makes no external call inside its transaction.
 * - A child create's `FOR SHARE` now also waits behind every `NO KEY UPDATE` of
 *   the `users` row, including the webhook's and the autocommit `users`
 *   updates, which the foreign-key `KEY SHARE` alone never waited for.
 * - The reverse holds too, and since story 80.1 for a forecast save as well:
 *   while a reader holds `FOR SHARE`, every `NO KEY UPDATE` of the row (a
 *   writer above, the webhook, an autocommit `users` update) waits for it to
 *   commit.
 * - A deadlock abort (`40P01`) is transient: `failureFromError` keeps the op
 *   queued, never permanent.
 *
 * ⚠️ If the `users` row is gone (erasure or the retention purge committed while
 * this waited), the SELECT locks nothing and returns no row. That is safe, not
 * checked: every caller then finds no live profile (the cascade answers
 * `already-deleted`, a create is refused, a promotion throws and stays queued,
 * the repair returns early), so no row is written for an erased account.
 */
export async function lockUserProfileSet(
  tx: DbTx,
  userId: string,
  strength: 'no key update' | 'share'
): Promise<void> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for(strength)
}
