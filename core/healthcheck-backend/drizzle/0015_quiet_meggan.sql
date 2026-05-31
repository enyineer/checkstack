CREATE TABLE "health_check_state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" text NOT NULL,
	"configuration_id" uuid NOT NULL,
	"from_status" "health_check_status",
	"to_status" "health_check_status" NOT NULL,
	"transitioned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_check_state_transitions" ADD CONSTRAINT "health_check_state_transitions_configuration_id_health_check_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."health_check_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_check_state_transitions_lookup_idx" ON "health_check_state_transitions" USING btree ("system_id","to_status","transitioned_at");--> statement-breakpoint
CREATE INDEX "health_check_state_transitions_system_recent_idx" ON "health_check_state_transitions" USING btree ("system_id","transitioned_at");