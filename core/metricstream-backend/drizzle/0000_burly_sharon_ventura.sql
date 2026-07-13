CREATE TABLE "metric_hourly_buckets" (
	"series_id" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"sum" double precision DEFAULT 0 NOT NULL,
	"min" double precision NOT NULL,
	"max" double precision NOT NULL,
	"last" double precision NOT NULL,
	"last_ts" timestamp with time zone NOT NULL,
	"delta_sum" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "metric_hourly_buckets_series_id_bucket_start_pk" PRIMARY KEY("series_id","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "metric_important_events" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_minute_buckets" (
	"series_id" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"sum" double precision DEFAULT 0 NOT NULL,
	"min" double precision NOT NULL,
	"max" double precision NOT NULL,
	"last" double precision NOT NULL,
	"last_ts" timestamp with time zone NOT NULL,
	"delta_sum" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "metric_minute_buckets_series_id_bucket_start_pk" PRIMARY KEY("series_id","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "metric_names" (
	"stream_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"counter_kind" text,
	"unit" text,
	"help" text,
	"series_count" bigint DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "metric_names_stream_id_name_pk" PRIMARY KEY("stream_id","name")
);
--> statement-breakpoint
CREATE TABLE "metric_scrape_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"interval_seconds" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"bearer_token_secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_scrape_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_series" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"name" text NOT NULL,
	"labels" jsonb NOT NULL,
	"counter_kind" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_stream_activity" (
	"stream_id" text PRIMARY KEY NOT NULL,
	"last_received_at" timestamp with time zone,
	"approx_datapoints_per_minute" bigint DEFAULT 0 NOT NULL,
	"dropped_series_count" bigint DEFAULT 0 NOT NULL,
	"dropped_datapoints_count" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_stream_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metric_streams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "metric_hourly_buckets_ts_idx" ON "metric_hourly_buckets" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "metric_important_events_stream_ts_idx" ON "metric_important_events" USING btree ("stream_id","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "metric_minute_buckets_ts_idx" ON "metric_minute_buckets" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "metric_scrape_targets_stream_idx" ON "metric_scrape_targets" USING btree ("stream_id");--> statement-breakpoint
CREATE INDEX "metric_series_stream_name_idx" ON "metric_series" USING btree ("stream_id","name");--> statement-breakpoint
CREATE INDEX "metric_series_stream_last_seen_idx" ON "metric_series" USING btree ("stream_id","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "metric_stream_tokens_hash_uq" ON "metric_stream_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "metric_stream_tokens_stream_idx" ON "metric_stream_tokens" USING btree ("stream_id");