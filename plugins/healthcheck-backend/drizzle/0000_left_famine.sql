CREATE TABLE "health_check_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"strategy_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"interval_seconds" integer NOT NULL,
	"is_template" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"configuration_id" uuid NOT NULL,
	"system_id" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_health_checks" (
	"system_id" text NOT NULL,
	"configuration_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_health_checks_system_id_configuration_id_pk" PRIMARY KEY("system_id","configuration_id")
);
--> statement-breakpoint
ALTER TABLE "health_check_runs" ADD CONSTRAINT "health_check_runs_configuration_id_health_check_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "health_check_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_health_checks" ADD CONSTRAINT "system_health_checks_configuration_id_health_check_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "health_check_configurations"("id") ON DELETE cascade ON UPDATE no action;