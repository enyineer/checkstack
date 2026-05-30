CREATE TABLE "secret_index" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vault_path" text NOT NULL,
	"vault_key" text NOT NULL,
	"description" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "secret_index_name_unique" UNIQUE("name")
);
