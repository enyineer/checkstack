CREATE INDEX "slo_achievements_system_achievement_idx" ON "slo_achievements" USING btree ("system_id","achievement");--> statement-breakpoint
CREATE INDEX "slo_daily_snapshots_objective_date_idx" ON "slo_daily_snapshots" USING btree ("objective_id","date");--> statement-breakpoint
CREATE INDEX "slo_downtime_events_open_by_objective_idx" ON "slo_downtime_events" USING btree ("objective_id") WHERE "slo_downtime_events"."end_time" IS NULL;--> statement-breakpoint
CREATE INDEX "slo_downtime_events_open_by_system_idx" ON "slo_downtime_events" USING btree ("system_id") WHERE "slo_downtime_events"."end_time" IS NULL;--> statement-breakpoint
CREATE INDEX "slo_downtime_events_objective_start_idx" ON "slo_downtime_events" USING btree ("objective_id","start_time");--> statement-breakpoint
CREATE INDEX "slo_objectives_system_id_idx" ON "slo_objectives" USING btree ("system_id");