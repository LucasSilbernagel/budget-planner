ALTER TABLE "balanceTracking" ADD COLUMN "sortOrder" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "sortOrder" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "incomeSources" ADD COLUMN "sortOrder" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "savingsGoals" ADD COLUMN "sortOrder" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- ============================================================================
-- Story 34.1a (FR60) — hand-appended per-row backfill.
--
-- `DEFAULT 0 NOT NULL` above already satisfies NOT NULL, so no nullable ->
-- SET NOT NULL dance is needed (contrast 0001's profileId backfill, which had to
-- do exactly that). These UPDATEs only REFINE the values: without them every
-- pre-existing row would sit at 0 and the read-time tiebreaker would silently
-- fall back to createdAt for the whole list.
--
-- THE RULE, mirrored by each zustand store's `migrate` (incomeStore/expenseStore/
-- savingsStore/balanceStore, persist version 3):
--     dense 0..n-1, per (userId, profileId) list, ordered createdAt ASC, id ASC.
--
-- ⚠️ SCOPE OF THAT MIRRORING, narrowed by code review 34.1a. The client backfill has
-- NO partition — it numbers the whole persisted array — so the two agree only for a
-- SINGLE-PROFILE client array. That is the only coherent state (the array is rendered
-- as one list), but a multi-profile array is currently reachable because `switchProfile`
-- does not clear these arrays; that pre-existing defect is logged in deferred-work.md
-- and fixing it makes the two rules identical by construction.
--
-- ⚠️ The `"id"` tiebreaker is load-bearing, not decorative. The client stamps
-- createdAt via `new Date().toISOString()` at millisecond precision, so two rows
-- created in the same millisecond — routine in tests and seeded fixtures — collide
-- on createdAt alone and ROW_NUMBER would break the tie arbitrarily. A client and
-- the server must not disagree about that tie.
--
-- ⚠️ Soft-deleted rows are EXCLUDED from the numbering (`isDeleted = false`) so the
-- live rows get exactly the 0..n-1 the client computes over its own array — the
-- client never holds tombstones (both the local delete path and the pull-merge
-- remove them outright). Tombstones keep the DEFAULT 0; they are filtered from
-- every read, so the value is inert.
--
-- ⚠️ savingsGoals and balanceTracking previously displayed NEWEST-FIRST (core's
-- `sortByCreationDate`). Ordering the backfill by createdAt ASC therefore REVERSES
-- those two lists once, on purpose (story 34.1a decision 1). The app is pre-launch,
-- so no user's data is affected.
--
-- ⚠️ `updatedAt` IS BUMPED DELIBERATELY (code review 34.1a, decision 2). The pull is
-- delta-by-`updatedAt` (`getSyncChanges`: `gt(incomeSources.updatedAt, sinceDate)`),
-- so WITHOUT this bump a device whose cursor has already passed these rows would
-- never receive the server's backfilled positions — it would keep its own
-- client-computed numbering indefinitely while a freshly-synced device got the SQL's.
-- Relative ORDER is already protected in that case (the client and server derive the
-- same rule, and `createdAt` breaks any tie), so this is defence-in-depth rather than a
-- fix for a live bug. The cost is a one-time full re-pull of these four tables on every
-- device, which is free pre-launch and cannot be added later without a new migration.
--
-- ⚠️ NOT APPLIED. `pnpm --filter db db:migrate` cannot run in this repo at all —
-- migration 0001 fails on an invalid integer -> uuid cast (deferred-work.md:322).
-- This file is generated and reviewed only, matching story 30-4a's precedent.
-- ============================================================================
UPDATE "incomeSources" t SET "sortOrder" = s."rn", "updatedAt" = now() FROM (
	SELECT "id", (ROW_NUMBER() OVER (
		PARTITION BY "userId", "profileId" ORDER BY "createdAt" ASC, "id" ASC
	) - 1) AS "rn"
	FROM "incomeSources" WHERE "isDeleted" = false
) s WHERE t."id" = s."id";--> statement-breakpoint
UPDATE "expenses" t SET "sortOrder" = s."rn", "updatedAt" = now() FROM (
	SELECT "id", (ROW_NUMBER() OVER (
		PARTITION BY "userId", "profileId" ORDER BY "createdAt" ASC, "id" ASC
	) - 1) AS "rn"
	FROM "expenses" WHERE "isDeleted" = false
) s WHERE t."id" = s."id";--> statement-breakpoint
UPDATE "savingsGoals" t SET "sortOrder" = s."rn", "updatedAt" = now() FROM (
	SELECT "id", (ROW_NUMBER() OVER (
		PARTITION BY "userId", "profileId" ORDER BY "createdAt" ASC, "id" ASC
	) - 1) AS "rn"
	FROM "savingsGoals" WHERE "isDeleted" = false
) s WHERE t."id" = s."id";--> statement-breakpoint
UPDATE "balanceTracking" t SET "sortOrder" = s."rn", "updatedAt" = now() FROM (
	SELECT "id", (ROW_NUMBER() OVER (
		PARTITION BY "userId", "profileId" ORDER BY "createdAt" ASC, "id" ASC
	) - 1) AS "rn"
	FROM "balanceTracking" WHERE "isDeleted" = false
) s WHERE t."id" = s."id";
