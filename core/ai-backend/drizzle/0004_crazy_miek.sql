CREATE TYPE "ai_permission_mode" AS ENUM('approve', 'auto');--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "permission_mode" "ai_permission_mode" DEFAULT 'approve' NOT NULL;