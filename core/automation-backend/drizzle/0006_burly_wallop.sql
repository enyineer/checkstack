CREATE TABLE "automation_wake_index" (
	"id" text PRIMARY KEY NOT NULL,
	"wait_lock_id" text NOT NULL,
	"ref" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_wake_index" ADD CONSTRAINT "automation_wake_index_wait_lock_id_automation_wait_locks_id_fk" FOREIGN KEY ("wait_lock_id") REFERENCES "automation_wait_locks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_wake_index_ref_idx" ON "automation_wake_index" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "automation_wake_index_lock_idx" ON "automation_wake_index" USING btree ("wait_lock_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_wake_index_lock_ref_unique" ON "automation_wake_index" USING btree ("wait_lock_id","ref");