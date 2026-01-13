CREATE TABLE "application_team" (
	"application_id" text NOT NULL,
	"team_id" text NOT NULL,
	CONSTRAINT "application_team_application_id_team_id_pk" PRIMARY KEY("application_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "resource_team_access" (
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_only" boolean DEFAULT false NOT NULL,
	"can_read" boolean DEFAULT true NOT NULL,
	"can_manage" boolean DEFAULT false NOT NULL,
	CONSTRAINT "resource_team_access_resource_type_resource_id_team_id_pk" PRIMARY KEY("resource_type","resource_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_manager" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "team_manager_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_team" (
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	CONSTRAINT "user_team_user_id_team_id_pk" PRIMARY KEY("user_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "application_team" ADD CONSTRAINT "application_team_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_team" ADD CONSTRAINT "application_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_team_access" ADD CONSTRAINT "resource_team_access_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_manager" ADD CONSTRAINT "team_manager_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_manager" ADD CONSTRAINT "team_manager_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_team" ADD CONSTRAINT "user_team_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_team" ADD CONSTRAINT "user_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade ON UPDATE no action;