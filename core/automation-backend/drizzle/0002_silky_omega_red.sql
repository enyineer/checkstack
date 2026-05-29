CREATE TABLE "automation_migration_failures" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"subscription_name" text NOT NULL,
	"provider_id" text NOT NULL,
	"event_id" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"provider_config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "automation_migration_failures_subscription_id_unique" UNIQUE("subscription_id")
);
