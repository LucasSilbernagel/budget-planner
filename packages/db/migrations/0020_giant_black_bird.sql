-- Story 66.5 / FR105-adjacent: the eight CHECK constraints declared in
-- `packages/db/src/schema.ts` finally reach the database.
--
-- ⚠️⚠️ THIS FILE IS HAND-AUTHORED AND `drizzle-kit generate` WILL NOT REPRODUCE IT.
-- drizzle-kit 0.23 does not model CHECK constraints at all — there is no
-- `checkConstraints` key in any `meta/*_snapshot.json`, and no `check()` block in
-- `schema.ts` has ever been emitted to SQL. That is why all eight were missing:
-- `grep -rin check migrations/*.sql` matched nothing but a COMMENT across
-- 0000-0019. If you regenerate this migration, these statements vanish silently.
-- `0020_snapshot.json` is therefore a copy of `0019`'s with a fresh id: it keeps
-- the numbering honest without pretending the tooling knows about the constraints.
--
-- ⚠️ This SUPERSEDES the note at `0016_neat_metal_master.sql:9`, which states that
-- none of the declarations had ever reached SQL. That was true when it was
-- written and it is left unedited — it is applied history, not a live claim.
--
-- ⚠️ VIOLATING ROWS: these are plain `ADD CONSTRAINT`, not `... NOT VALID`, so
-- PostgreSQL scans each table NOW and this migration FAILS if any stored row
-- breaks its constraint. That is deliberate (Lucas's call, 2026-09-24). A
-- migration that refuses to apply is the correct signal; `NOT VALID` would leave
-- the schema asserting an invariant the stored rows do not satisfy, which is the
-- same class of untruth this story exists to end. If it fails on a dev database,
-- fix or delete the offending row — pre-launch there is no production data.
--
-- ⚠️ `balanceTracking.currentBalance` deliberately gets NO constraint: debt
-- balances are negative by design. Only `savingsGoals.currentBalance` is bounded.
-- `packages/db/src/check-constraints.test.ts` pins both halves of that asymmetry.

ALTER TABLE "users" ADD CONSTRAINT "users_email_not_empty" CHECK ("email" <> '');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_paddleId_not_empty" CHECK ("paddleId" <> '');--> statement-breakpoint
ALTER TABLE "incomeSources" ADD CONSTRAINT "incomeSources_amount_positive" CHECK ("amount" > 0);--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);--> statement-breakpoint
ALTER TABLE "savingsGoals" ADD CONSTRAINT "savingsGoals_targetAmount_positive" CHECK ("targetAmount" IS NULL OR "targetAmount" > 0);--> statement-breakpoint
ALTER TABLE "savingsGoals" ADD CONSTRAINT "savingsGoals_currentBalance_non_negative" CHECK ("currentBalance" >= 0);--> statement-breakpoint
ALTER TABLE "savingsGoals" ADD CONSTRAINT "savingsGoals_monthlyAllocation_non_negative" CHECK ("monthlyAllocation" IS NULL OR "monthlyAllocation" >= 0);--> statement-breakpoint
ALTER TABLE "balanceTracking" ADD CONSTRAINT "balanceTracking_monthlyContribution_non_negative" CHECK ("monthlyContribution" >= 0);
