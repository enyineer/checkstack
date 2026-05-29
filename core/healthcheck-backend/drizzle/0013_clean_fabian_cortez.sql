CREATE TABLE "health_check_auto_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"system_id" text NOT NULL,
	"configuration_id" uuid NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "health_check_unhealthy_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"configuration_id" uuid NOT NULL,
	"system_id" text NOT NULL,
	"transitioned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_check_auto_incidents" ADD CONSTRAINT "health_check_auto_incidents_configuration_id_health_check_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "health_check_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_unhealthy_transitions" ADD CONSTRAINT "health_check_unhealthy_transitions_configuration_id_health_check_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "health_check_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_check_auto_incidents_active_by_system_idx" ON "health_check_auto_incidents" USING btree ("system_id","closed_at");--> statement-breakpoint
CREATE INDEX "health_check_unhealthy_transitions_lookup_idx" ON "health_check_unhealthy_transitions" USING btree ("configuration_id","system_id","transitioned_at");