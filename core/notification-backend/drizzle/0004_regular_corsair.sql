ALTER TABLE "notifications" ADD COLUMN "body" text NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "action" jsonb;--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "actions";