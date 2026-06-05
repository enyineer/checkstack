CREATE TYPE "ai_tool_call_status" AS ENUM('proposed', 'applied', 'executed', 'failed', 'expired', 'rejected');--> statement-breakpoint
CREATE TYPE "ai_tool_effect" AS ENUM('read', 'mutate', 'destructive');--> statement-breakpoint
CREATE TYPE "ai_transport" AS ENUM('chat', 'mcp');--> statement-breakpoint
CREATE TABLE "ai_tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_kind" text NOT NULL,
	"principal_id" text NOT NULL,
	"transport" "ai_transport" NOT NULL,
	"conversation_id" text,
	"tool_name" text NOT NULL,
	"effect" "ai_tool_effect" NOT NULL,
	"args_hash" text NOT NULL,
	"status" "ai_tool_call_status" NOT NULL,
	"proposal_nonce" text,
	"proposal_expires_at" timestamp,
	"result_snapshot" jsonb,
	"proposed_payload" jsonb,
	"error" text,
	"proposed_at" timestamp,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_tool_calls_principal_created_idx" ON "ai_tool_calls" USING btree ("principal_kind","principal_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_tool_calls_status_expires_idx" ON "ai_tool_calls" USING btree ("status","proposal_expires_at");--> statement-breakpoint
CREATE INDEX "ai_tool_calls_conversation_idx" ON "ai_tool_calls" USING btree ("conversation_id");