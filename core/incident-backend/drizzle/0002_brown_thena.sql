CREATE TABLE "incident_links" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"label" text,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incident_links" ADD CONSTRAINT "incident_links_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade ON UPDATE no action;