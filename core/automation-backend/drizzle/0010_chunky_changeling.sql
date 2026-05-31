ALTER TABLE "automations" ADD COLUMN "group" text;--> statement-breakpoint
CREATE INDEX "automations_group_idx" ON "automations" USING btree ("group");