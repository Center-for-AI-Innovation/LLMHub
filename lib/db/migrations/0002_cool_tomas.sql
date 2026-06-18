CREATE TABLE "EmailNotification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deploymentId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"type" varchar NOT NULL,
	"status" varchar NOT NULL,
	CONSTRAINT "uq_emailnotification_deployment_userid_type" UNIQUE("deploymentId","userId","type")
);
--> statement-breakpoint
ALTER TABLE "EmailNotification" ADD CONSTRAINT "EmailNotification_deploymentId_ModelDeployment_id_fk" FOREIGN KEY ("deploymentId") REFERENCES "public"."ModelDeployment"("id") ON DELETE cascade ON UPDATE no action;