ALTER TABLE "anomalies" ADD COLUMN "suppressed_at" timestamp;--> statement-breakpoint
ALTER TABLE "anomalies" ADD COLUMN "suppressed_value" double precision;--> statement-breakpoint
ALTER TABLE "anomalies" ADD COLUMN "suppressed_baseline" double precision;