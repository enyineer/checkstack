CREATE TABLE "resource_access_settings" (
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"team_only" boolean DEFAULT false NOT NULL,
	CONSTRAINT "resource_access_settings_resource_type_resource_id_pk" PRIMARY KEY("resource_type","resource_id")
);
--> statement-breakpoint
ALTER TABLE "resource_team_access" DROP COLUMN "team_only";