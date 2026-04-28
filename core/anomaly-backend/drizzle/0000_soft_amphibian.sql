CREATE TYPE "anomaly_direction" AS ENUM('above', 'below', 'changed');--> statement-breakpoint
CREATE TYPE "anomaly_state" AS ENUM('suspicious', 'anomaly', 'recovered');--> statement-breakpoint
CREATE TABLE "anomalies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" text NOT NULL,
	"configuration_id" uuid NOT NULL,
	"field_path" text NOT NULL,
	"state" "anomaly_state" NOT NULL,
	"direction" "anomaly_direction" NOT NULL,
	"baseline_value" double precision,
	"baseline_std_dev" double precision,
	"observed_value" text NOT NULL,
	"deviation" double precision NOT NULL,
	"suspicious_run_count" integer DEFAULT 0 NOT NULL,
	"confirmation_threshold" integer NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"recovered_at" timestamp,
	"metadata" jsonb
);
