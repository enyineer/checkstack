CREATE TABLE "dependency_derived_states" (
	"system_id" text PRIMARY KEY NOT NULL,
	"derived_state" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
