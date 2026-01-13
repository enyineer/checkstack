ALTER TABLE "permission" RENAME TO "access_rule";--> statement-breakpoint
ALTER TABLE "disabled_default_permission" RENAME TO "disabled_default_access_rule";--> statement-breakpoint
ALTER TABLE "disabled_public_default_permission" RENAME TO "disabled_public_default_access_rule";--> statement-breakpoint
ALTER TABLE "role_permission" RENAME TO "role_access_rule";--> statement-breakpoint
ALTER TABLE "disabled_default_access_rule" RENAME COLUMN "permission_id" TO "access_rule_id";--> statement-breakpoint
ALTER TABLE "disabled_public_default_access_rule" RENAME COLUMN "permission_id" TO "access_rule_id";--> statement-breakpoint
ALTER TABLE "role_access_rule" RENAME COLUMN "permission_id" TO "access_rule_id";--> statement-breakpoint
ALTER TABLE "disabled_default_access_rule" DROP CONSTRAINT "disabled_default_permission_permission_id_permission_id_fk";
--> statement-breakpoint
ALTER TABLE "disabled_public_default_access_rule" DROP CONSTRAINT "disabled_public_default_permission_permission_id_permission_id_fk";
--> statement-breakpoint
ALTER TABLE "role_access_rule" DROP CONSTRAINT "role_permission_role_id_role_id_fk";
--> statement-breakpoint
ALTER TABLE "role_access_rule" DROP CONSTRAINT "role_permission_permission_id_permission_id_fk";
--> statement-breakpoint
ALTER TABLE "role_access_rule" DROP CONSTRAINT "role_permission_role_id_permission_id_pk";--> statement-breakpoint
ALTER TABLE "role_access_rule" ADD CONSTRAINT "role_access_rule_role_id_access_rule_id_pk" PRIMARY KEY("role_id","access_rule_id");--> statement-breakpoint
ALTER TABLE "disabled_default_access_rule" ADD CONSTRAINT "disabled_default_access_rule_access_rule_id_access_rule_id_fk" FOREIGN KEY ("access_rule_id") REFERENCES "access_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disabled_public_default_access_rule" ADD CONSTRAINT "disabled_public_default_access_rule_access_rule_id_access_rule_id_fk" FOREIGN KEY ("access_rule_id") REFERENCES "access_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_access_rule" ADD CONSTRAINT "role_access_rule_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_access_rule" ADD CONSTRAINT "role_access_rule_access_rule_id_access_rule_id_fk" FOREIGN KEY ("access_rule_id") REFERENCES "access_rule"("id") ON DELETE no action ON UPDATE no action;