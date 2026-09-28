CREATE TABLE IF NOT EXISTS "jobRuns" (
	"name" varchar(64) PRIMARY KEY NOT NULL,
	"leaseUntil" bigint,
	"lastCompletedAt" bigint
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "accessEndedAt" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "retentionNoticeSentAt" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "retentionNoticeAttemptedAt" bigint;--> statement-breakpoint
-- Story 73.2 (HAND-APPENDED below this line; `drizzle-kit generate` does not
-- emit data statements, so a regeneration drops both of them silently).
--
-- Backfill the retention clock for rows that are ALREADY lapsed. No column
-- recorded the day access ended before this migration, so the best available
-- date is `entitlementUpdatedAt` (the newest entitlement-changing event), and
-- for a row that never saw one, the moment this migration runs.
-- ⚠️ Both arms err LATE, never early: the watermark is at or after the real
-- lapse (it advances on every later `subscription.*` event), and "now" is after
-- any lapse. `updatedAt` was deliberately NOT used: nothing writes it after
-- insert, so it is the signup time — before the lapse (code review 73.2).
-- Entitled rows keep NULL.
UPDATE "users" SET "accessEndedAt" = COALESCE("entitlementUpdatedAt", (extract(epoch from now()) * 1000)::bigint) WHERE "subscriptionStatus" IN ('canceled', 'free') AND "accessEndedAt" IS NULL;--> statement-breakpoint
-- Seed the retention sweep's lease/heartbeat row. `lastCompletedAt` NULL means
-- "never run"; the in-app backstop stays unarmed until a first run completes.
INSERT INTO "jobRuns" ("name") VALUES ('retention-sweep') ON CONFLICT ("name") DO NOTHING;
