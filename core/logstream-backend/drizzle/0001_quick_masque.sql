CREATE TABLE "log_pattern_variable_buckets" (
	"stream_id" text NOT NULL,
	"pattern_id" text NOT NULL,
	"var_index" smallint NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"sum" double precision DEFAULT 0 NOT NULL,
	"min" double precision NOT NULL,
	"max" double precision NOT NULL,
	CONSTRAINT "log_pattern_variable_buckets_stream_id_pattern_id_var_index_bucket_start_pk" PRIMARY KEY("stream_id","pattern_id","var_index","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "log_pattern_variable_hourly" (
	"stream_id" text NOT NULL,
	"pattern_id" text NOT NULL,
	"var_index" smallint NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"sum" double precision DEFAULT 0 NOT NULL,
	"min" double precision NOT NULL,
	"max" double precision NOT NULL,
	CONSTRAINT "log_pattern_variable_hourly_stream_id_pattern_id_var_index_bucket_start_pk" PRIMARY KEY("stream_id","pattern_id","var_index","bucket_start")
);
--> statement-breakpoint
ALTER TABLE "log_patterns" ADD COLUMN "origin" text DEFAULT 'mined' NOT NULL;--> statement-breakpoint
CREATE INDEX "log_pattern_variable_buckets_ts_idx" ON "log_pattern_variable_buckets" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "log_pattern_variable_hourly_ts_idx" ON "log_pattern_variable_hourly" USING btree ("bucket_start");