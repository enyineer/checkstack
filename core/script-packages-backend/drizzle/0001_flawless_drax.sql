CREATE TABLE "script_package_blob_gc_state" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"last_run_at" timestamp,
	"last_deleted" integer DEFAULT 0 NOT NULL,
	"last_bytes_reclaimed" bigint DEFAULT 0 NOT NULL,
	"total_bytes_reclaimed" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_package_lockfile_history" (
	"lockfile_hash" text PRIMARY KEY NOT NULL,
	"manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "script_package_lockfile_history_recorded_idx" ON "script_package_lockfile_history" USING btree ("recorded_at");