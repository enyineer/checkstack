CREATE TYPE "deletion_policy" AS ENUM('orphan', 'auto');--> statement-breakpoint
CREATE TYPE "provenance_status" AS ENUM('synced', 'error', 'orphaned');--> statement-breakpoint
CREATE TYPE "provider_type" AS ENUM('github', 'gitlab');--> statement-breakpoint
CREATE TABLE "provenance" (
	"id" text PRIMARY KEY NOT NULL,
	"api_version" text NOT NULL,
	"kind" text NOT NULL,
	"entity_name" text NOT NULL,
	"entity_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"repository" text NOT NULL,
	"file_path" text NOT NULL,
	"last_sync_hash" text NOT NULL,
	"status" "provenance_status" DEFAULT 'synced' NOT NULL,
	"error_message" text,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "provider_type" NOT NULL,
	"target" text NOT NULL,
	"path_pattern" text NOT NULL,
	"auth_token" text,
	"base_url" text,
	"sync_interval" integer DEFAULT 300 NOT NULL,
	"deletion_policy" "deletion_policy" DEFAULT 'orphan' NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "provenance" ADD CONSTRAINT "provenance_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE cascade ON UPDATE no action;