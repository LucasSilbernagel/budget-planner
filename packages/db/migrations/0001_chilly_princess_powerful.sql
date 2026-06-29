-- IF NOT EXISTS makes these enum extensions re-runnable (Story 5-14 review P5):
-- without it a retry after any mid-migration failure aborts on "enum label already
-- exists". (Supported since PostgreSQL 9.6.)
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'INR';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'BRL';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'MXN';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'KRW';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'SGD';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'HKD';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'NOK';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'DKK';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'PLN';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'TRY';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forecastingProfiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"profileId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"scenarioData" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "forecastingProfiles_userId_profileId_name_unique" UNIQUE("userId","profileId","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rateLimits" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"requestCount" integer DEFAULT 0 NOT NULL,
	"windowStart" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "balanceTracking" DROP CONSTRAINT "balanceTracking_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "incomeSources" DROP CONSTRAINT "incomeSources_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "savingsGoals" DROP CONSTRAINT "savingsGoals_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "userProfiles" DROP CONSTRAINT "userProfiles_userId_users_id_fk";
--> statement-breakpoint
-- userProfiles.id: serial(integer) -> uuid (Story 5-14 fix). PostgreSQL cannot
-- cast integer -> uuid implicitly, so the original in-place `SET DATA TYPE uuid`
-- failed even on an EMPTY table and hard-blocked `db:migrate`. Drop the serial
-- `nextval` default first, then convert with an explicit USING that mints a fresh
-- uuid per row (the children.profileId columns are ADDED + backfilled from these
-- new ids just below, and forecastingProfiles is created empty in this migration,
-- so reassigning userProfiles ids loses no relationship). Rebuilds the PK index.
ALTER TABLE "userProfiles" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "userProfiles" ALTER COLUMN "id" SET DATA TYPE uuid USING gen_random_uuid();--> statement-breakpoint
ALTER TABLE "userProfiles" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "userProfiles" ALTER COLUMN "description" SET DATA TYPE text;--> statement-breakpoint
-- Self-sufficient backfill (Story 5-14 review P1): auto-create a default profile
-- for every user that OWNS financial rows but has NO userProfiles row, so the
-- `profileId SET NOT NULL` below can never abort on a populated DB. Runs AFTER the
-- userProfiles.id→uuid conversion (new rows get a uuid via the column default) and
-- BEFORE the children backfill (which then finds this default profile). No-op on a
-- fresh/empty DB. Idempotent: the NOT EXISTS guard means a re-run adds nothing.
INSERT INTO "userProfiles" ("userId", name, "isDefault", currency)
SELECT u.id, 'Main Profile', true, COALESCE(u.currency, 'NONE'::"currency")
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM "userProfiles" p WHERE p."userId" = u.id)
  AND (
    EXISTS (SELECT 1 FROM "incomeSources" i WHERE i."userId" = u.id)
    OR EXISTS (SELECT 1 FROM expenses e WHERE e."userId" = u.id)
    OR EXISTS (SELECT 1 FROM "savingsGoals" s WHERE s."userId" = u.id)
    OR EXISTS (SELECT 1 FROM "balanceTracking" b WHERE b."userId" = u.id)
  );--> statement-breakpoint
-- children.profileId: add NULLABLE -> backfill each row to its user's default
-- (else first) profile -> SET NOT NULL (Story 5-14 fix). The original
-- `ADD COLUMN ... uuid NOT NULL` failed on POPULATED tables (existing rows have no
-- value). On a fresh/empty DB the UPDATE/SET NOT NULL are no-ops. PRECONDITION for
-- populated DBs: every user that owns financial rows must have >=1 userProfiles
-- row, or the SET NOT NULL will fail (a deliberate guard against silently
-- orphaning data — seed/ensure a default profile per user before migrating).
ALTER TABLE "balanceTracking" ADD COLUMN "profileId" uuid;--> statement-breakpoint
UPDATE "balanceTracking" c SET "profileId" = (
	SELECT p."id" FROM "userProfiles" p
	WHERE p."userId" = c."userId"
	ORDER BY p."isDefault" DESC, p."createdAt" ASC
	LIMIT 1
) WHERE c."profileId" IS NULL;--> statement-breakpoint
ALTER TABLE "balanceTracking" ALTER COLUMN "profileId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "profileId" uuid;--> statement-breakpoint
UPDATE "expenses" c SET "profileId" = (
	SELECT p."id" FROM "userProfiles" p
	WHERE p."userId" = c."userId"
	ORDER BY p."isDefault" DESC, p."createdAt" ASC
	LIMIT 1
) WHERE c."profileId" IS NULL;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "profileId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "incomeSources" ADD COLUMN "profileId" uuid;--> statement-breakpoint
UPDATE "incomeSources" c SET "profileId" = (
	SELECT p."id" FROM "userProfiles" p
	WHERE p."userId" = c."userId"
	ORDER BY p."isDefault" DESC, p."createdAt" ASC
	LIMIT 1
) WHERE c."profileId" IS NULL;--> statement-breakpoint
ALTER TABLE "incomeSources" ALTER COLUMN "profileId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "savingsGoals" ADD COLUMN "profileId" uuid;--> statement-breakpoint
UPDATE "savingsGoals" c SET "profileId" = (
	SELECT p."id" FROM "userProfiles" p
	WHERE p."userId" = c."userId"
	ORDER BY p."isDefault" DESC, p."createdAt" ASC
	LIMIT 1
) WHERE c."profileId" IS NULL;--> statement-breakpoint
ALTER TABLE "savingsGoals" ALTER COLUMN "profileId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "isDeleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updatedAt" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecastingProfiles_userId_idx" ON "forecastingProfiles" ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecastingProfiles_profileId_idx" ON "forecastingProfiles" ("profileId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecastingProfiles_userId_profileId_idx" ON "forecastingProfiles" ("userId","profileId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rateLimits_userId_idx" ON "rateLimits" ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "balanceTracking_userId_profileId_idx" ON "balanceTracking" ("userId","profileId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_userId_profileId_idx" ON "expenses" ("userId","profileId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incomeSources_userId_profileId_idx" ON "incomeSources" ("userId","profileId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savingsGoals_userId_profileId_idx" ON "savingsGoals" ("userId","profileId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "userProfiles_userId_idx" ON "userProfiles" ("userId");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balanceTracking" ADD CONSTRAINT "balanceTracking_profileId_userProfiles_id_fk" FOREIGN KEY ("profileId") REFERENCES "userProfiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balanceTracking" ADD CONSTRAINT "balanceTracking_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_profileId_userProfiles_id_fk" FOREIGN KEY ("profileId") REFERENCES "userProfiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incomeSources" ADD CONSTRAINT "incomeSources_profileId_userProfiles_id_fk" FOREIGN KEY ("profileId") REFERENCES "userProfiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incomeSources" ADD CONSTRAINT "incomeSources_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savingsGoals" ADD CONSTRAINT "savingsGoals_profileId_userProfiles_id_fk" FOREIGN KEY ("profileId") REFERENCES "userProfiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savingsGoals" ADD CONSTRAINT "savingsGoals_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "userProfiles" ADD CONSTRAINT "userProfiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forecastingProfiles" ADD CONSTRAINT "forecastingProfiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forecastingProfiles" ADD CONSTRAINT "forecastingProfiles_profileId_userProfiles_id_fk" FOREIGN KEY ("profileId") REFERENCES "userProfiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rateLimits" ADD CONSTRAINT "rateLimits_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
