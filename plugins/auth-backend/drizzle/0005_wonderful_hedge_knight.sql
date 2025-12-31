CREATE TABLE "disabled_public_default_permission" (
	"permission_id" text PRIMARY KEY NOT NULL,
	"disabled_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disabled_public_default_permission" ADD CONSTRAINT "disabled_public_default_permission_permission_id_permission_id_fk" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE no action ON UPDATE no action;