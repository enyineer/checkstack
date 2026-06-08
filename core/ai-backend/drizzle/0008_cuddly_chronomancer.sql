CREATE TABLE "ai_skill" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"targets" jsonb NOT NULL,
	"system_prompt" text,
	"prompt_template" text,
	"suggested_output_fields" jsonb,
	"tags" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_skill_owner_idx" ON "ai_skill" USING btree ("owner_id","updated_at");