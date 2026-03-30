CREATE TABLE IF NOT EXISTS "AuthorizedUsers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"modelId" varchar(255) NOT NULL,
	"modelName" varchar(255) NOT NULL,
	"ownerId" uuid NOT NULL,
	"ownerEmail" varchar(255) NOT NULL,
	"allowedUserIds" uuid[] NOT NULL,
	"allowedUserEmails" varchar(255)[] NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" ALTER COLUMN "allowedUserIds" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" ALTER COLUMN "allowedUserEmails" DROP NOT NULL;
