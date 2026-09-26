DO $$ BEGIN
 CREATE TYPE "public"."billingInterval" AS ENUM('month', 'year');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "billingInterval" "billingInterval";