CREATE TABLE IF NOT EXISTS "VllmChatJob" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chatId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"slurmJobId" varchar(50) NOT NULL,
	"modelName" varchar(255),
	"endpointUrl" varchar(255),
	"proxyUrl" varchar(255),
	"status" varchar DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "VllmChatJob" ADD CONSTRAINT "VllmChatJob_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."Chat"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "VllmChatJob" ADD CONSTRAINT "VllmChatJob_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
