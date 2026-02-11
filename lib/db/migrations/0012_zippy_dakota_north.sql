ALTER TABLE "AvailableModel" ALTER COLUMN "status" SET DEFAULT 'warm';--> statement-breakpoint
ALTER TABLE "ModelDeployment" ADD COLUMN "proxyUrl" varchar(255);--> statement-breakpoint
ALTER TABLE "ModelDeployment" DROP COLUMN IF EXISTS "tunnelUrl";