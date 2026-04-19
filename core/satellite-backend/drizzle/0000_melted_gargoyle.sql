CREATE TABLE "satellites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"last_heartbeat_at" timestamp,
	"version" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
