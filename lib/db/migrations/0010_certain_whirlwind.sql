ALTER TABLE "User" ADD COLUMN "apiKeyHash" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "apiKeyExpiresAt" timestamp;
ALTER TABLE "AvailableModel" ALTER COLUMN "status" SET DEFAULT 'warm';--> statement-breakpoint
ALTER TABLE "ModelDeployment" DROP COLUMN IF EXISTS "tunnelUrl";