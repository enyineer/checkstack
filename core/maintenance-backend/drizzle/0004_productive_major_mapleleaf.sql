CREATE TYPE "maintenance_content_visibility" AS ENUM('public', 'logged_in', 'internal');--> statement-breakpoint
ALTER TABLE "maintenance_links" ADD COLUMN "visibility" "maintenance_content_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_updates" ADD COLUMN "visibility" "maintenance_content_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_updates" ADD COLUMN "edited_at" timestamp;