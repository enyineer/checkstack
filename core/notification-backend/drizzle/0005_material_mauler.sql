ALTER TABLE "notifications" ADD COLUMN "subjects" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_collapse_idx" ON "notifications" USING btree ("user_id","group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");