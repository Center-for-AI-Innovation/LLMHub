CREATE TABLE IF NOT EXISTS "AvailableModel" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" varchar DEFAULT 'WARM' NOT NULL,
	"type" varchar NOT NULL,
	"family" varchar(100) NOT NULL,
	"variant" varchar(100) NOT NULL,
	"modelType" varchar(50),
	"specs" json NOT NULL,
	"vocabSize" integer,
	"huggingfaceId" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
