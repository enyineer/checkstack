ALTER TABLE "automation_wait_locks" ADD COLUMN "wait_config" jsonb;--> statement-breakpoint
CREATE INDEX "automation_wait_locks_kind_idx" ON "automation_wait_locks" USING btree ("kind");