ALTER TABLE "satellites" ADD COLUMN "connection_status" text DEFAULT 'offline' NOT NULL;--> statement-breakpoint
ALTER TABLE "satellites" ADD COLUMN "last_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "satellites" ADD COLUMN "last_connection_event" text;