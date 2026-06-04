CREATE TABLE "script_package_audit_advisory" (
	"lockfile_hash" text NOT NULL,
	"advisory_id" text NOT NULL,
	"package_name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"severity" text NOT NULL,
	"vulnerable_versions" text DEFAULT '' NOT NULL,
	"url" text,
	"cvss_score" double precision,
	"notified" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "script_package_audit_advisory_lockfile_hash_advisory_id_package_name_pk" PRIMARY KEY("lockfile_hash","advisory_id","package_name")
);
--> statement-breakpoint
CREATE TABLE "script_package_audit_state" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"last_run_at" timestamp,
	"lockfile_hash" text,
	"total" integer DEFAULT 0 NOT NULL,
	"count_low" integer DEFAULT 0 NOT NULL,
	"count_moderate" integer DEFAULT 0 NOT NULL,
	"count_high" integer DEFAULT 0 NOT NULL,
	"count_critical" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX "script_package_audit_advisory_hash_idx" ON "script_package_audit_advisory" USING btree ("lockfile_hash");