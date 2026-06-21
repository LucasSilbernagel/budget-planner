-- Migration: Add rate_limits table for server-side rate limiting
-- Story: 4-3-implement-multi-device-data-synchronization-for-paid-tier
-- Purpose: Database-backed rate limiting for data sovereignty (NFR1, NFR2)
-- Created: 2026-06-20

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
DO $$ BEGIN
 ALTER TABLE "rateLimits" ADD CONSTRAINT "rateLimits_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rateLimits_userId_idx" ON "rateLimits" ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rateLimits_windowStart_idx" ON "rateLimits" ("windowStart");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rateLimits_userId_windowStart_idx" ON "rateLimits" ("userId", "windowStart");
