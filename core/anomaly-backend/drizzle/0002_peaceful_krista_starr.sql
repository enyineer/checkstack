CREATE TABLE "anomaly_assignments" (
	"system_id" text NOT NULL,
	"configuration_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	CONSTRAINT "anomaly_assignments_pk" UNIQUE("system_id","configuration_id")
);
--> statement-breakpoint
CREATE TABLE "anomaly_configurations" (
	"configuration_id" uuid PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anomaly_baselines" ADD CONSTRAINT "anomaly_baselines_unique_path" UNIQUE("system_id","configuration_id","field_path");