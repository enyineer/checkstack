CREATE TYPE "contact_type" AS ENUM('user', 'mailbox');--> statement-breakpoint
CREATE TABLE "system_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"type" "contact_type" NOT NULL,
	"user_id" text,
	"email" text,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_contacts" ADD CONSTRAINT "system_contacts_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "systems" DROP COLUMN "owner";