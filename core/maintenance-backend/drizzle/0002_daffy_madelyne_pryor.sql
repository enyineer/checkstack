CREATE TABLE "maintenance_links" (
	"id" text PRIMARY KEY NOT NULL,
	"maintenance_id" text NOT NULL,
	"label" text,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maintenance_links" ADD CONSTRAINT "maintenance_links_maintenance_id_maintenances_id_fk" FOREIGN KEY ("maintenance_id") REFERENCES "maintenances"("id") ON DELETE cascade ON UPDATE no action;