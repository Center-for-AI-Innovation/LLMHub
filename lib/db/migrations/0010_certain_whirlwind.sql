ALTER TABLE "User" ADD COLUMN "apiKeyHash" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "apiKeyExpiresAt" timestamp;
ALTER TABLE "AvailableModel" ALTER COLUMN "status" SET DEFAULT 'cold';--> statement-breakpoint
ALTER TABLE "ModelDeployment" RENAME COLUMN "tunnelUrl" TO "proxyUrl";