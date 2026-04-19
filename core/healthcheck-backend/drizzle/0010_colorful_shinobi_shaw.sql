DROP INDEX "health_check_aggregates_bucket_unique";--> statement-breakpoint
ALTER TABLE "health_check_aggregates" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "health_check_aggregates" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "health_check_runs" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "health_check_runs" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "system_health_checks" ADD COLUMN "satellite_ids" jsonb;--> statement-breakpoint
ALTER TABLE "system_health_checks" ADD COLUMN "include_local" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "health_check_aggregates_bucket_unique" ON "health_check_aggregates" USING btree ("configuration_id","system_id","bucket_start","bucket_size","source_id");