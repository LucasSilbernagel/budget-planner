/**
 * Which sync failures are PERMANENT — story 75.1, FR119.
 *
 * A sync operation the server can never accept used to be reported as a 200
 * envelope with `failedCount > 0` and no status code. The client maps that to
 * `retryable: false` with no `statusCode`, core files it under
 * `unclassifiedFailedOperations`, and KEEPS IT QUEUED — so it replays every cycle
 * until the circuit breaker opens and all sync for the account stops.
 *
 * This module names the failures that are positive proof of permanence, so the
 * server can mark them and core can drop them (`processBatchSync` →
 * `rejections`; `features/api/client.ts` maps a listed op to `statusCode: 422`).
 *
 * ## ⚠️⚠️ An ALLOW-LIST, and the omissions are the point
 *
 * "Permanent" means the outcome depends on NOTHING but the operation's own data —
 * no replay, no other op landing first, no change of server state can make it
 * succeed. Anything this module does not name stays exactly where it was: kept
 * queued. That is the same rule as core's `PERMANENT_REJECT_STATUS_CODES`, whose
 * docblock records what classifying on the ABSENCE of a signal cost before: a
 * single DB blip deleted users' queued edits.
 *
 * Deliberately NOT permanent, although they are integrity errors:
 * - `23503` foreign key — `incomeSources.categoryId` / `expenses.categoryId`
 *   reference `categories.id`, and the queue ranks only PROFILE creates first, so
 *   an income row whose category create is still queued (or stranded retrying)
 *   fails now and succeeds once the category lands.
 * - `23505` unique — `userProfiles_one_default_per_user` refuses a promotion that
 *   arrives before its paired demotion or tombstone, and the categories live-name
 *   index refuses the first half of a rename swap. Both clear on replay.
 * - Transient errors (`40001`, `40P01`, `57014`, connection loss, anything with no
 *   `code`). ⚠️ They stay in the KEPT-queued bucket too, NOT the retryable one: a
 *   retryable op leaves the persisted queue and lives only in memory, and past
 *   the retry budget it is lost on reload (FR120, story 75.3).
 *
 * ⚠️ Narrowed by the story 75.1 code review (decision D2, Lucas, 2026-09-28) to the
 * codes the op's OWN data can still produce. `23502`, `22P02`, `22001` and the
 * datetime codes were in the first cut, but the server's zod gate
 * (`syncOperationSchema`) already refuses every op-data cause of them — required
 * fields, `.max()` lengths matching the varchar, uuid and enum validation — so in
 * practice they now arise from SERVER-side skew: e.g. the deploy window where a
 * migration has run and the old code still serves. Classified permanent, that
 * would drop every affected op for every user at once.
 *
 * ⚠️ `23514` is op-data ONLY because every CHECK in this schema is SINGLE-column
 * (the eight in `packages/db/migrations/0020_*.sql`). An UPDATE is a partial
 * `.set()`, and a single-column CHECK can only fail on a column the op itself
 * sets. A MULTI-column CHECK would let the stored half of the row decide — an
 * ordering dependency — and would have to be re-argued here before it ships.
 *
 * Before ADDING a code, write down why its outcome cannot depend on any other row
 * AND why the server gate does not already refuse its op-data cause.
 */

/**
 * Stable, closed set of reasons a refusal can carry to the client (AC-6). Never
 * the driver's message: that names tables, columns and constraints, and goes to
 * the log instead.
 */
export type SyncRejectionReason = 'constraint' | 'invalid'

/** One permanently refused operation, as reported in the batch envelope. */
export interface SyncRejection {
  operationId: string
  reason: SyncRejectionReason
}

/**
 * SQLSTATEs that are positive proof the operation's OWN data is unacceptable.
 * Values are the reason reported to the client.
 */
const PERMANENT_SQLSTATES: ReadonlyMap<string, SyncRejectionReason> = new Map([
  // check_violation: a single-column predicate over a value the op sets — e.g.
  // `savingsGoals.currentBalance >= 0`, which the server gate does not bound.
  ['23514', 'constraint'],
  // numeric_value_out_of_range: amounts are `z.number().int()` with no int32
  // bound on the server gate, so an overflow is the op's own value.
  ['22003', 'invalid'],
])

/**
 * The SQLSTATE of a database error, or `undefined`.
 *
 * MEASURED on PGlite through drizzle-orm 0.32.2 (story 75.1, Task 2): the code is
 * on the thrown error itself — `error.code` — not on a wrapped `cause`. node-postgres
 * (production) populates the same field. Reuses the shape of `isUniqueViolation`
 * in `server/functions/forecastingProfiles.ts`.
 */
export function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * The violated constraint's name, for the LOG only. ⚠️ `error.constraint`, NOT
 * `error.constraint_name`: PGlite and node-postgres use the former, and story
 * 66.5 shipped a RED run that was red only because it read the latter.
 */
export function constraintOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined
  const constraint = (error as { constraint?: unknown }).constraint
  return typeof constraint === 'string' ? constraint : undefined
}

/**
 * The reason to report if `error` is a PERMANENT refusal, or `undefined` if it
 * is not — in which case the caller must leave its failure exactly as it was.
 */
export function permanentRejectionReason(error: unknown): SyncRejectionReason | undefined {
  const code = sqlStateOf(error)
  return code === undefined ? undefined : PERMANENT_SQLSTATES.get(code)
}
