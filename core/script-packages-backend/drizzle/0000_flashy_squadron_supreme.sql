CREATE TABLE "script_package_blob" (
	"integrity" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"backend" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_package_install_state" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"lockfile_hash" text,
	"manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_size_bytes" bigint DEFAULT 0 NOT NULL,
	"last_installed_at" timestamp,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "script_package_registry_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"registry_url" text DEFAULT 'https://registry.npmjs.org/' NOT NULL,
	"scoped_registries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auth_secret_ref" text,
	"ignore_scripts" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_package_satellite_state" (
	"satellite_id" text PRIMARY KEY NOT NULL,
	"lockfile_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"synced_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "script_package_size_cap" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"warn_bytes" bigint DEFAULT 157286400 NOT NULL,
	"block_bytes" bigint DEFAULT 314572800 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_package_storage_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"active_backend" text DEFAULT 'postgres' NOT NULL,
	"migration_status" text DEFAULT 'idle' NOT NULL,
	"migration_target" text,
	"migrated_count" integer DEFAULT 0 NOT NULL,
	"migration_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_packages" (
	"name" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"added_by" text,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "script_package_blob_backend_idx" ON "script_package_blob" USING btree ("backend");