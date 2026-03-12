ALTER TABLE "AuthorizedUsers" DROP CONSTRAINT IF EXISTS "AuthorizedUsers_deploymentId_unique";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP CONSTRAINT IF EXISTS "AuthorizedUsers_deploymentId_ownerId_ModelDeployment_id_userId_fk";
--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" ADD COLUMN IF NOT EXISTS "userId" uuid;--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" ADD COLUMN IF NOT EXISTS "permission" varchar DEFAULT 'owner';--> statement-breakpoint
DO $$
BEGIN
 IF EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
   AND table_name = 'AuthorizedUsers'
   AND column_name = 'ownerId'
 ) THEN
  UPDATE "AuthorizedUsers"
  SET "userId" = "ownerId"
  WHERE "userId" IS NULL;
 END IF;
END $$;
--> statement-breakpoint
UPDATE "AuthorizedUsers"
SET "permission" = 'owner'
WHERE "permission" IS NULL;--> statement-breakpoint
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "AuthorizedUsers" WHERE "userId" IS NULL) THEN
  ALTER TABLE "AuthorizedUsers" ALTER COLUMN "userId" SET NOT NULL;
 END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "AuthorizedUsers" WHERE "permission" IS NULL) THEN
  ALTER TABLE "AuthorizedUsers" ALTER COLUMN "permission" SET NOT NULL;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AuthorizedUsers" ADD CONSTRAINT "AuthorizedUsers_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "ownerId";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "allowedUserIds";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "allowedUserEmails";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AuthorizedUsers" ADD CONSTRAINT "AuthorizedUsers_deploymentId_userId_unique" UNIQUE("deploymentId","userId");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
