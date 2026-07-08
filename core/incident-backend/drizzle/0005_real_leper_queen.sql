CREATE TYPE "incident_content_visibility" AS ENUM('public', 'logged_in', 'internal');--> statement-breakpoint
ALTER TABLE "incident_links" ADD COLUMN "visibility" "incident_content_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD COLUMN "visibility" "incident_content_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD COLUMN "edited_at" timestamp;