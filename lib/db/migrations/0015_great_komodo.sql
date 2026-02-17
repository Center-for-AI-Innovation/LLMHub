ALTER TABLE "ModelDeployment" RENAME COLUMN "tunnelUrl" TO "proxyUrl";--> statement-breakpoint
ALTER TABLE "AvailableModel" ALTER COLUMN "status" SET DEFAULT 'cold';--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "modelId";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "modelName";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "ownerEmail";