CREATE TABLE "plugin_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_name" text NOT NULL,
	"version" text NOT NULL,
	"bundle_id" uuid,
	"tarball" text NOT NULL,
	"content_hash" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_install_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_name" text,
	"bundle_id" uuid,
	"action" text NOT NULL,
	"phase" text NOT NULL,
	"status" text NOT NULL,
	"source" jsonb,
	"error" text,
	"instance_id" text NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "version" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "bundle_id" uuid;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_artifacts_name_version_idx" ON "plugin_artifacts" USING btree ("plugin_name","version");--> statement-breakpoint
CREATE INDEX "plugin_artifacts_content_hash_idx" ON "plugin_artifacts" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "plugin_install_events_name_created_idx" ON "plugin_install_events" USING btree ("plugin_name","created_at");--> statement-breakpoint
CREATE INDEX "plugin_install_events_status_created_idx" ON "plugin_install_events" USING btree ("status","created_at");