ALTER TABLE "anomaly_baselines" DROP CONSTRAINT "anomaly_baselines_unique_path";--> statement-breakpoint
ALTER TABLE "anomaly_baselines" ADD COLUMN "environment_id" text;--> statement-breakpoint
ALTER TABLE "anomaly_baselines" ADD CONSTRAINT "anomaly_baselines_unique_path" UNIQUE NULLS NOT DISTINCT("system_id","configuration_id","environment_id","field_path");