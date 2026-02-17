ALTER TABLE "AuthorizedUsers" DROP CONSTRAINT "AuthorizedUsers_modelId_ownerId_ModelDeployment_modelId_userId_fk";
--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" ADD COLUMN "deploymentId" uuid NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AuthorizedUsers" ADD CONSTRAINT "AuthorizedUsers_deploymentId_ModelDeployment_id_fk" FOREIGN KEY ("deploymentId") REFERENCES "public"."ModelDeployment"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AuthorizedUsers" ADD CONSTRAINT "AuthorizedUsers_deploymentId_ownerId_ModelDeployment_id_userId_fk" FOREIGN KEY ("deploymentId","ownerId") REFERENCES "public"."ModelDeployment"("id","userId") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" ADD CONSTRAINT "AuthorizedUsers_deploymentId_unique" UNIQUE("deploymentId");