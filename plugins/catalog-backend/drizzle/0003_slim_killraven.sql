CREATE TYPE "public"."system_status" AS ENUM('healthy', 'degraded', 'unhealthy');--> statement-breakpoint
ALTER TABLE "systems" ALTER COLUMN "status" SET DEFAULT 'healthy'::"public"."system_status";--> statement-breakpoint
ALTER TABLE "systems" ALTER COLUMN "status" SET DATA TYPE "public"."system_status" USING "status"::"public"."system_status";