-- Story SEC-2: unify the auth + sync rate limiters onto one atomic DB-backed store.
--
-- rateLimits holds ONLY transient counters (fixed windows <= 15 min), so clearing
-- it on deploy is harmless — every bucket refills within one window. TRUNCATE-first
-- lets us add the NOT NULL `scope`/`subject` columns without backfilling `subject`
-- from `userId`, and guarantees the new UNIQUE (scope, subject, windowStart) index
-- can never hit a duplicate from legacy per-user rows.
TRUNCATE TABLE "rateLimits";--> statement-breakpoint
ALTER TABLE "rateLimits" ALTER COLUMN "userId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rateLimits" ADD COLUMN "scope" varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE "rateLimits" ADD COLUMN "subject" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rateLimits_scope_subject_window_idx" ON "rateLimits" USING btree ("scope","subject","windowStart");
