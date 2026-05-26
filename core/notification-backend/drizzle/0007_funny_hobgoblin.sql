CREATE TYPE "notification_delivery_status" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "notification_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"strategy_qualified_id" text NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"error_message" text,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_notification_idx" ON "notification_delivery_attempts" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_attempted_at_idx" ON "notification_delivery_attempts" USING btree ("attempted_at");