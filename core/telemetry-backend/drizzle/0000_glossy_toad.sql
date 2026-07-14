CREATE TABLE "telemetry_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"bindings" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_seconds" integer,
	"satellite_id" text,
	"webhook_secret_hash" text,
	"webhook_secret_prefix" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telemetry_sources_type_idx" ON "telemetry_sources" USING btree ("source_type_id");--> statement-breakpoint
CREATE INDEX "telemetry_sources_enabled_idx" ON "telemetry_sources" USING btree ("enabled");