CREATE TABLE "automation_window_events" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"trigger_id" text NOT NULL,
	"event_id" text NOT NULL,
	"context_key" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_window_events" ADD CONSTRAINT "automation_window_events_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_window_events_count_idx" ON "automation_window_events" USING btree ("automation_id","trigger_id","context_key","occurred_at");--> statement-breakpoint
CREATE INDEX "automation_window_events_prune_idx" ON "automation_window_events" USING btree ("occurred_at");