CREATE TABLE "automation_run_state" (
	"run_id" text PRIMARY KEY NOT NULL,
	"scope_snapshot" jsonb NOT NULL,
	"last_action_path" text,
	"last_heartbeat_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_wait_locks" ADD COLUMN "kind" text DEFAULT 'trigger' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_run_state" ADD CONSTRAINT "automation_run_state_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_run_state_heartbeat_idx" ON "automation_run_state" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "automation_wait_locks_run_idx" ON "automation_wait_locks" USING btree ("run_id");