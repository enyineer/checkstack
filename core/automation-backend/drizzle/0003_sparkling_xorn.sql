CREATE TABLE "automation_dwell_timers" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"trigger_id" text NOT NULL,
	"event_id" text NOT NULL,
	"context_key" text,
	"armed_status" text,
	"payload_snapshot" jsonb NOT NULL,
	"actor_snapshot" jsonb NOT NULL,
	"fire_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_dwell_timers" ADD CONSTRAINT "automation_dwell_timers_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_dwell_timers_key_unique" ON "automation_dwell_timers" USING btree ("automation_id","trigger_id","context_key");--> statement-breakpoint
CREATE INDEX "automation_dwell_timers_fire_at_idx" ON "automation_dwell_timers" USING btree ("fire_at");--> statement-breakpoint
CREATE INDEX "automation_dwell_timers_automation_idx" ON "automation_dwell_timers" USING btree ("automation_id");