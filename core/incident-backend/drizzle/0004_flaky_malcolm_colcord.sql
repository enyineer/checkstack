CREATE TYPE "incident_health_override" AS ENUM('degraded', 'unhealthy');--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "health_override" "incident_health_override";