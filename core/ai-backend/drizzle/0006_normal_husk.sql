CREATE TYPE "ai_memory_scope" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TABLE "ai_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"scope" "ai_memory_scope" NOT NULL,
	"system_id" text,
	"recall_hint" text NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb,
	"source_conversation_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_memory_owner_idx" ON "ai_memory" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_memory_system_idx" ON "ai_memory" USING btree ("system_id","updated_at");