ALTER TABLE "health_check_aggregates" DROP CONSTRAINT "health_check_aggregates_bucket_unique";--> statement-breakpoint
DROP INDEX "health_check_state_transitions_lookup_idx";--> statement-breakpoint
DROP INDEX "health_check_state_transitions_system_recent_idx";--> statement-breakpoint
ALTER TABLE "health_check_aggregates" ADD COLUMN "environment_id" text;--> statement-breakpoint
ALTER TABLE "health_check_runs" ADD COLUMN "environment_id" text;--> statement-breakpoint
ALTER TABLE "health_check_state_transitions" ADD COLUMN "environment_id" text;--> statement-breakpoint
ALTER TABLE "system_health_checks" ADD COLUMN "environment_ids" jsonb;--> statement-breakpoint
CREATE INDEX "health_check_state_transitions_lookup_idx" ON "health_check_state_transitions" USING btree ("system_id","environment_id","to_status","transitioned_at");--> statement-breakpoint
CREATE INDEX "health_check_state_transitions_system_recent_idx" ON "health_check_state_transitions" USING btree ("system_id","environment_id","transitioned_at");--> statement-breakpoint
ALTER TABLE "health_check_aggregates" ADD CONSTRAINT "health_check_aggregates_bucket_unique" UNIQUE NULLS NOT DISTINCT("configuration_id","system_id","environment_id","bucket_start","bucket_size","source_id");