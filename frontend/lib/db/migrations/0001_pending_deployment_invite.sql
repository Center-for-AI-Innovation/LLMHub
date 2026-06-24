CREATE TABLE "PendingDeploymentInvite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deploymentId" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"permission" varchar DEFAULT 'user' NOT NULL,
	"invitedBy" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "PendingDeploymentInvite_deploymentId_email_unique" UNIQUE("deploymentId","email")
);
--> statement-breakpoint
ALTER TABLE "PendingDeploymentInvite" ADD CONSTRAINT "PendingDeploymentInvite_deploymentId_ModelDeployment_id_fk" FOREIGN KEY ("deploymentId") REFERENCES "public"."ModelDeployment"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "PendingDeploymentInvite" ADD CONSTRAINT "PendingDeploymentInvite_invitedBy_User_id_fk" FOREIGN KEY ("invitedBy") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "PendingDeploymentInvite_email_idx" ON "PendingDeploymentInvite" USING btree ("email");
