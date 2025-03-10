CREATE TABLE IF NOT EXISTS "AvailableModel" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "status" varchar DEFAULT 'WARM' NOT NULL,
  "type" varchar NOT NULL,
  "family" varchar(100) NOT NULL,
  "variant" varchar(100) NOT NULL,
  "modelType" varchar(50),
  "specs" jsonb NOT NULL,
  "vocabSize" integer,
  "huggingfaceId" varchar(255),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

-- Add index for faster lookups by family
CREATE INDEX IF NOT EXISTS "idx_available_model_family" ON "AvailableModel" ("family");

-- Add index for faster lookups by type
CREATE INDEX IF NOT EXISTS "idx_available_model_type" ON "AvailableModel" ("type"); 