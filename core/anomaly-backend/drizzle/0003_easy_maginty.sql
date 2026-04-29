CREATE TYPE "anomaly_kind" AS ENUM('spike', 'drift');--> statement-breakpoint
ALTER TABLE "anomalies" ADD COLUMN "kind" "anomaly_kind" DEFAULT 'spike' NOT NULL;