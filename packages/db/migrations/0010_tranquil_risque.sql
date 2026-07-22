DO $$ BEGIN
 CREATE TYPE "public"."allocationMode" AS ENUM('manual', 'automatic');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "savingsGoals" ADD COLUMN "monthlyAllocation" integer;--> statement-breakpoint
ALTER TABLE "savingsGoals" ADD COLUMN "allocationMode" "allocationMode" DEFAULT 'automatic' NOT NULL;