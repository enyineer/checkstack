CREATE TABLE "application" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"secret_hash" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "application_role" (
	"application_id" text NOT NULL,
	"role_id" text NOT NULL,
	CONSTRAINT "application_role_application_id_role_id_pk" PRIMARY KEY("application_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_role" ADD CONSTRAINT "application_role_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_role" ADD CONSTRAINT "application_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE no action ON UPDATE no action;