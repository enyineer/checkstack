CREATE TABLE "ai_spend" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"principal_kind" text NOT NULL,
	"principal_id" text NOT NULL,
	"conversation_id" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "model_messages" jsonb;--> statement-breakpoint
CREATE INDEX "ai_spend_integration_principal_created_idx" ON "ai_spend" USING btree ("integration_id","principal_kind","principal_id","created_at");