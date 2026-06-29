-- Migration 0003: entity primary keys serial(integer) -> uuid (Story 5-14)
--
-- WHY: incomeSources/expenses/savingsGoals/balanceTracking used server-assigned
-- serial integer PKs. A row created offline held a client temp id the server
-- never honored, so on pull the server row (keyed by its integer id) could not be
-- matched to the local row -> duplicate rows. uuid PKs let the client generate the
-- id up front so the row has the SAME id on every device (AC-1/AC-4).
--
-- PATTERN: add-column -> swap-PK (the add → backfill → swap pattern from
-- 0000_fix_users_id_type_to_uuid.sql). These four tables are FK LEAVES — no other
-- table references their id (only userId -> users.id and profileId ->
-- userProfiles.id point OUTWARD) — so there is no child FK to rewire (AC-3 is
-- satisfied trivially for them). Drizzle's generated `ALTER COLUMN id SET DATA
-- TYPE uuid` is replaced here because PostgreSQL cannot cast integer -> uuid
-- without a USING clause (it fails even on an empty table); the column swap below
-- both preserves every non-id column/row (zero data loss, AC-2) and assigns a
-- fresh uuid per row via the column DEFAULT.
--
-- ROLLBACK: there is no lossless inverse — the original serial ids are discarded
-- (nothing referenced them, so they carried no relational meaning). To roll back,
-- restore from a pre-migration backup. See the Dev Agent Record in the 5-14 story.

-- incomeSources ---------------------------------------------------------------
ALTER TABLE "incomeSources" ADD COLUMN "id_new" uuid NOT NULL DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "incomeSources" DROP CONSTRAINT "incomeSources_pkey";--> statement-breakpoint
ALTER TABLE "incomeSources" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "incomeSources" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "incomeSources" ADD PRIMARY KEY ("id");--> statement-breakpoint

-- expenses --------------------------------------------------------------------
ALTER TABLE "expenses" ADD COLUMN "id_new" uuid NOT NULL DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_pkey";--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "expenses" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "expenses" ADD PRIMARY KEY ("id");--> statement-breakpoint

-- savingsGoals ----------------------------------------------------------------
ALTER TABLE "savingsGoals" ADD COLUMN "id_new" uuid NOT NULL DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "savingsGoals" DROP CONSTRAINT "savingsGoals_pkey";--> statement-breakpoint
ALTER TABLE "savingsGoals" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "savingsGoals" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "savingsGoals" ADD PRIMARY KEY ("id");--> statement-breakpoint

-- balanceTracking -------------------------------------------------------------
ALTER TABLE "balanceTracking" ADD COLUMN "id_new" uuid NOT NULL DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "balanceTracking" DROP CONSTRAINT "balanceTracking_pkey";--> statement-breakpoint
ALTER TABLE "balanceTracking" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "balanceTracking" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "balanceTracking" ADD PRIMARY KEY ("id");
