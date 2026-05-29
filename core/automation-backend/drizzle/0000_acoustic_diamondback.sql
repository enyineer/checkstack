CREATE TABLE "automation_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"action_id" text,
	"artifact_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"context_key" text,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"action_path" text NOT NULL,
	"action_id" text,
	"action_kind" text NOT NULL,
	"provider_action_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"result_payload" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"trigger_id" text NOT NULL,
	"trigger_event_id" text NOT NULL,
	"trigger_payload" jsonb NOT NULL,
	"context_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "automation_wait_locks" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"action_path" text NOT NULL,
	"event_id" text NOT NULL,
	"context_key" text,
	"filter_template" text,
	"timeout_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'enabled' NOT NULL,
	"definition" jsonb NOT NULL,
	"managed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_artifacts" ADD CONSTRAINT "automation_artifacts_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_artifacts" ADD CONSTRAINT "automation_artifacts_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_artifacts" ADD CONSTRAINT "automation_artifacts_step_id_automation_run_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "automation_run_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run_steps" ADD CONSTRAINT "automation_run_steps_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_wait_locks" ADD CONSTRAINT "automation_wait_locks_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_artifacts_context_lookup_idx" ON "automation_artifacts" USING btree ("automation_id","context_key","artifact_type","created_at");--> statement-breakpoint
CREATE INDEX "automation_artifacts_action_lookup_idx" ON "automation_artifacts" USING btree ("automation_id","action_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_artifacts_open_idx" ON "automation_artifacts" USING btree ("automation_id","closed_at");--> statement-breakpoint
CREATE INDEX "automation_run_steps_run_idx" ON "automation_run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_idx" ON "automation_runs" USING btree ("automation_id","started_at");--> statement-breakpoint
CREATE INDEX "automation_runs_status_idx" ON "automation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automation_runs_context_key_idx" ON "automation_runs" USING btree ("automation_id","context_key");--> statement-breakpoint
CREATE INDEX "automation_wait_locks_event_lookup_idx" ON "automation_wait_locks" USING btree ("event_id","context_key");--> statement-breakpoint
CREATE INDEX "automation_wait_locks_timeout_idx" ON "automation_wait_locks" USING btree ("timeout_at");--> statement-breakpoint
CREATE INDEX "automations_status_idx" ON "automations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automations_managed_by_idx" ON "automations" USING btree ("managed_by");