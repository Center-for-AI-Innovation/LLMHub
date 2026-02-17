ALTER TABLE "AuthorizedUsers" DROP CONSTRAINT "AuthorizedUsers_deploymentId_unique";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP CONSTRAINT "AuthorizedUsers_deploymentId_ownerId_ModelDeployment_id_userId_fk";
--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" ADD COLUMN "userId" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" ADD COLUMN "permission" varchar DEFAULT 'owner' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AuthorizedUsers" ADD CONSTRAINT "AuthorizedUsers_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "ownerId";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "allowedUserIds";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "allowedUserEmails";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" ADD CONSTRAINT "AuthorizedUsers_deploymentId_userId_unique" UNIQUE("deploymentId","userId");