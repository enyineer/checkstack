DROP INDEX "health_check_aggregates_bucket_unique";--> statement-breakpoint

-- Clean up duplicate local (source_id IS NULL) hourly buckets that were
-- created due to the missing NULLS NOT DISTINCT clause. Keep the row with
-- the highest id (most recent insert) for each bucket group.
DELETE FROM "health_check_aggregates" a
USING "health_check_aggregates" b
WHERE a.source_id IS NULL
  AND b.source_id IS NULL
  AND a.configuration_id = b.configuration_id
  AND a.system_id = b.system_id
  AND a.bucket_start = b.bucket_start
  AND a.bucket_size = b.bucket_size
  AND a.id < b.id;--> statement-breakpoint

ALTER TABLE "health_check_aggregates" ADD CONSTRAINT "health_check_aggregates_bucket_unique" UNIQUE NULLS NOT DISTINCT("configuration_id","system_id","bucket_start","bucket_size","source_id");