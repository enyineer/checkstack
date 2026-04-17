CREATE TYPE "impact_type" AS ENUM('informational', 'degraded', 'critical');--> statement-breakpoint
CREATE TABLE "dependencies" (
	"id" text PRIMARY KEY NOT NULL,
	"source_system_id" text NOT NULL,
	"target_system_id" text NOT NULL,
	"impact_type" "impact_type" DEFAULT 'degraded' NOT NULL,
	"transitive" boolean DEFAULT false NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_dependency_edge" UNIQUE("source_system_id","target_system_id")
);
--> statement-breakpoint
CREATE TABLE "dependency_health_check_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"dependency_id" text NOT NULL,
	"health_check_id" text NOT NULL,
	"override_impact_type" "impact_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"system_id" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dependency_health_check_rules" ADD CONSTRAINT "dependency_health_check_rules_dependency_id_dependencies_id_fk" FOREIGN KEY ("dependency_id") REFERENCES "dependencies"("id") ON DELETE cascade ON UPDATE no action;