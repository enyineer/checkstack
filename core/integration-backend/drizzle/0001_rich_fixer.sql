ALTER TABLE "webhook_subscriptions" ADD COLUMN "event_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" DROP COLUMN "event_types";