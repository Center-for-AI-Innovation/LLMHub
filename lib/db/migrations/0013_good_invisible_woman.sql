ALTER TABLE "AuthorizedUsers" ALTER COLUMN "allowedUserIds" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "AuthorizedUsers" ALTER COLUMN "allowedUserEmails" DROP NOT NULL;