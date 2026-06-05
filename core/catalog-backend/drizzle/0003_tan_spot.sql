CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metadata" json DEFAULT '{}'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "systems_environments" (
	"system_id" text NOT NULL,
	"environment_id" text NOT NULL,
	CONSTRAINT "systems_environments_system_id_environment_id_pk" PRIMARY KEY("system_id","environment_id")
);
--> statement-breakpoint
ALTER TABLE "systems_environments" ADD CONSTRAINT "systems_environments_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "systems_environments" ADD CONSTRAINT "systems_environments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE cascade ON UPDATE no action;