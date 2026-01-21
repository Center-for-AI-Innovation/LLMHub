ALTER TABLE "ModelDeployment" RENAME COLUMN "expirationTime" TO "expiresAt";--> statement-breakpoint
ALTER TABLE "ModelDeployment" ADD COLUMN "modelId" varchar(255) NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ModelDeployment" ADD CONSTRAINT "ModelDeployment_modelId_AvailableModel_id_fk" FOREIGN KEY ("modelId") REFERENCES "public"."AvailableModel"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
