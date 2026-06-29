DO $$ BEGIN
 CREATE TYPE "currency" AS ENUM('NONE', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'SEK', 'NZD');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "financeType" AS ENUM('investment', 'debt');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "frequency" AS ENUM('weekly', 'biweekly', 'monthly', 'annually');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "subscriptionStatus" AS ENUM('free', 'active', 'past_due', 'canceled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balanceTracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"type" "financeType" NOT NULL,
	"name" varchar(255) NOT NULL,
	"currentBalance" integer DEFAULT 0 NOT NULL,
	"maxContributionLimit" integer,
	"monthlyContribution" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"amount" integer NOT NULL,
	"frequency" "frequency" NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incomeSources" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"amount" integer NOT NULL,
	"frequency" "frequency" NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "savingsGoals" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"targetAmount" integer NOT NULL,
	"currentBalance" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "userProfiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" varchar(500),
	"isDefault" boolean DEFAULT false NOT NULL,
	"currency" "currency" DEFAULT 'NONE',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"paddleId" varchar(255) NOT NULL,
	"subscriptionStatus" "subscriptionStatus" DEFAULT 'free' NOT NULL,
	"currency" "currency" DEFAULT 'NONE',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_paddleId_unique" UNIQUE("paddleId")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balanceTracking" ADD CONSTRAINT "balanceTracking_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incomeSources" ADD CONSTRAINT "incomeSources_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savingsGoals" ADD CONSTRAINT "savingsGoals_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "userProfiles" ADD CONSTRAINT "userProfiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
