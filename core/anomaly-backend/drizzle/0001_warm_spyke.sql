CREATE TABLE "anomaly_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" text NOT NULL,
	"configuration_id" uuid NOT NULL,
	"field_path" text NOT NULL,
	"mean" double precision NOT NULL,
	"std_dev" double precision NOT NULL,
	"trend_slope" double precision NOT NULL,
	"sample_count" integer NOT NULL,
	"computed_at" timestamp NOT NULL,
	"dominant_value" text,
	"dominant_ratio" double precision
);
