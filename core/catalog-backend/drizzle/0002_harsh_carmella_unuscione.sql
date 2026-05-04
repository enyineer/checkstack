CREATE TABLE "system_links" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"label" text,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_links" ADD CONSTRAINT "system_links_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "systems"("id") ON DELETE cascade ON UPDATE no action;