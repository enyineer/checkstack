CREATE TABLE "slo_achievements" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"achievement" text NOT NULL,
	"unlocked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slo_daily_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"objective_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"availability_percent" double precision NOT NULL,
	"budget_consumed_minutes" double precision NOT NULL,
	"budget_remaining_percent" double precision NOT NULL,
	"burn_rate" double precision,
	"streak_days" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slo_downtime_events" (
	"id" text PRIMARY KEY NOT NULL,
	"objective_id" text NOT NULL,
	"system_id" text NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"duration_seconds" double precision,
	"attribution_type" text NOT NULL,
	"upstream_system_id" text,
	"upstream_system_name" text
);
--> statement-breakpoint
CREATE TABLE "slo_objectives" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"health_check_configuration_id" text,
	"target" double precision NOT NULL,
	"window_days" integer NOT NULL,
	"dependency_exclusion" text DEFAULT 'strict' NOT NULL,
	"excluded_dependency_ids" json,
	"burn_rate_warning_percent" double precision DEFAULT 50 NOT NULL,
	"burn_rate_critical_percent" double precision DEFAULT 80 NOT NULL,
	"burn_rate_fast_burn_multiplier" double precision DEFAULT 5 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slo_streaks" (
	"objective_id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"streak_start" timestamp,
	"best_streak_end" timestamp
);
--> statement-breakpoint
ALTER TABLE "slo_daily_snapshots" ADD CONSTRAINT "slo_daily_snapshots_objective_id_slo_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "slo_objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slo_downtime_events" ADD CONSTRAINT "slo_downtime_events_objective_id_slo_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "slo_objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slo_streaks" ADD CONSTRAINT "slo_streaks_objective_id_slo_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "slo_objectives"("id") ON DELETE cascade ON UPDATE no action;