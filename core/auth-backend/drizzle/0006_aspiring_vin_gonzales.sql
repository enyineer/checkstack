CREATE TABLE "resource_create_grant" (
	"resource_type" text NOT NULL,
	"team_id" text NOT NULL,
	CONSTRAINT "resource_create_grant_resource_type_team_id_pk" PRIMARY KEY("resource_type","team_id")
);
--> statement-breakpoint
ALTER TABLE "resource_team_access" ADD COLUMN "is_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_create_grant" ADD CONSTRAINT "resource_create_grant_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_team_access_owner_unique" ON "resource_team_access" USING btree ("resource_type","resource_id") WHERE "resource_team_access"."is_owner" = true;--> statement-breakpoint
CREATE INDEX "resource_team_access_owner_by_team" ON "resource_team_access" USING btree ("team_id") WHERE "resource_team_access"."is_owner" = true;