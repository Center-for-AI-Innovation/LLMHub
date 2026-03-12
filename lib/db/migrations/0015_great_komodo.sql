DO $$
BEGIN
 IF EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
   AND table_name = 'ModelDeployment'
   AND column_name = 'tunnelUrl'
 ) AND NOT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
   AND table_name = 'ModelDeployment'
   AND column_name = 'proxyUrl'
 ) THEN
  ALTER TABLE "ModelDeployment" RENAME COLUMN "tunnelUrl" TO "proxyUrl";
 END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AuthorizedUsers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"modelId" varchar(255),
	"modelName" varchar(255),
	"ownerId" uuid NOT NULL,
	"ownerEmail" varchar(255),
	"allowedUserIds" uuid[],
	"allowedUserEmails" varchar(255)[],
	"deploymentId" uuid NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AvailableModel" ALTER COLUMN "status" SET DEFAULT 'cold';--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "modelId";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "modelName";--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" DROP COLUMN IF EXISTS "ownerEmail";
