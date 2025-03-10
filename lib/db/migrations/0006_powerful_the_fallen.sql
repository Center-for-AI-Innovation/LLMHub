CREATE TABLE IF NOT EXISTS "ModelDeployment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"modelName" varchar(255) NOT NULL,
	"userId" uuid NOT NULL,
	"slurmJobId" varchar(50) NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"endpointUrl" varchar(255),
	"tunnelUrl" varchar(255),
	"errorMessage" text,
	"resourceAllocation" json,
	"expirationTime" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ResourceAllocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resourceType" varchar(50) NOT NULL,
	"resourceName" varchar(50) NOT NULL,
	"totalCount" integer NOT NULL,
	"allocatedCount" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ModelDeployment" ADD CONSTRAINT "ModelDeployment_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
