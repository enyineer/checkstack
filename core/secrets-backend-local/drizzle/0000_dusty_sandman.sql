CREATE TABLE "secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"description" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_name_unique" UNIQUE("name")
);
