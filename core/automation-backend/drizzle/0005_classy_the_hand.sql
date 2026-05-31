CREATE TABLE "entity_state" (
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_state_kind_entity_id_pk" PRIMARY KEY("kind","entity_id")
);
--> statement-breakpoint
CREATE TABLE "entity_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"from_value" text,
	"to_value" text NOT NULL,
	"transitioned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "entity_transitions_lookup_idx" ON "entity_transitions" USING btree ("kind","entity_id","field","transitioned_at");