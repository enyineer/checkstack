ALTER TABLE "metric_scrape_targets" ADD COLUMN "satellite_id" text;--> statement-breakpoint
CREATE INDEX "metric_scrape_targets_satellite_idx" ON "metric_scrape_targets" USING btree ("satellite_id");