ALTER TABLE "ModelDeployment" ADD CONSTRAINT "ModelDeployment_modelId_userId_unique" UNIQUE("modelId","userId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AuthorizedUsers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"modelId" varchar(255) NOT NULL,
	"modelName" varchar(255) NOT NULL,
	"ownerId" uuid NOT NULL,
	"ownerEmail" varchar(255) NOT NULL,
	"allowedUserIds" uuid[] NOT NULL,
	"allowedUserEmails" varchar(255)[] NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AuthorizedUsers" ADD CONSTRAINT "AuthorizedUsers_modelId_ownerId_ModelDeployment_modelId_userId_fk" FOREIGN KEY ("modelId","ownerId") REFERENCES "public"."ModelDeployment"("modelId","userId") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;