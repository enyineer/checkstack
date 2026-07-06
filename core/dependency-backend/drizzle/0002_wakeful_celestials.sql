ALTER TABLE "dependency_health_check_rules" ALTER COLUMN "health_check_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dependency_health_check_rules" ADD COLUMN "environment_id" text;