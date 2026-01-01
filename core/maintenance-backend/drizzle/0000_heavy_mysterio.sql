CREATE TYPE "maintenance_status" AS ENUM('scheduled', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "maintenance_systems" (
	"maintenance_id" text NOT NULL,
	"system_id" text NOT NULL,
	CONSTRAINT "maintenance_systems_maintenance_id_system_id_pk" PRIMARY KEY("maintenance_id","system_id")
);
--> statement-breakpoint
CREATE TABLE "maintenance_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"maintenance_id" text NOT NULL,
	"message" text NOT NULL,
	"status_change" "maintenance_status",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "maintenances" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "maintenance_status" DEFAULT 'scheduled' NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD CONSTRAINT "maintenance_systems_maintenance_id_maintenances_id_fk" FOREIGN KEY ("maintenance_id") REFERENCES "maintenances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_maintenance_id_maintenances_id_fk" FOREIGN KEY ("maintenance_id") REFERENCES "maintenances"("id") ON DELETE cascade ON UPDATE no action;