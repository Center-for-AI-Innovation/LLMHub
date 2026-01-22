ALTER TABLE "User" ADD COLUMN "apiKeyHash" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "apiKeyExpiresAt" timestamp;