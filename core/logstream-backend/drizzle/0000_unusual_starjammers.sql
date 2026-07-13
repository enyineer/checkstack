CREATE TABLE "log_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "log_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stream_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"severity_number" integer NOT NULL,
	"severity_text" text,
	"band" text NOT NULL,
	"body" text NOT NULL,
	"attributes" jsonb,
	"resource" jsonb,
	"pattern_id" text,
	"trace_id" text,
	"span_id" text
);
--> statement-breakpoint
CREATE TABLE "log_important_events" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"severity_number" integer,
	"pattern_id" text,
	"title" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_pattern_buckets" (
	"stream_id" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"pattern_id" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "log_pattern_buckets_stream_id_bucket_start_pattern_id_pk" PRIMARY KEY("stream_id","bucket_start","pattern_id")
);
--> statement-breakpoint
CREATE TABLE "log_pattern_hourly" (
	"stream_id" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"pattern_id" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "log_pattern_hourly_stream_id_bucket_start_pattern_id_pk" PRIMARY KEY("stream_id","bucket_start","pattern_id")
);
--> statement-breakpoint
CREATE TABLE "log_patterns" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"template" text NOT NULL,
	"token_count" integer NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"sample_body" text NOT NULL,
	"total_count" bigint DEFAULT 0 NOT NULL,
	"severity_max" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_severity_buckets" (
	"stream_id" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"band" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "log_severity_buckets_stream_id_bucket_start_band_pk" PRIMARY KEY("stream_id","bucket_start","band")
);
--> statement-breakpoint
CREATE TABLE "log_severity_hourly" (
	"stream_id" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"band" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "log_severity_hourly_stream_id_bucket_start_band_pk" PRIMARY KEY("stream_id","bucket_start","band")
);
--> statement-breakpoint
CREATE TABLE "log_stream_activity" (
	"stream_id" text PRIMARY KEY NOT NULL,
	"last_received_at" timestamp with time zone,
	"last_flush_at" timestamp with time zone,
	"approx_rate_per_minute" bigint DEFAULT 0 NOT NULL,
	"silence_event_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "log_stream_tokens" (
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
CREATE TABLE "log_streams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "log_events_stream_ts_idx" ON "log_events" USING btree ("stream_id","ts" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "log_events_stream_pattern_ts_idx" ON "log_events" USING btree ("stream_id","pattern_id","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "log_events_ts_idx" ON "log_events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "log_important_events_stream_ts_idx" ON "log_important_events" USING btree ("stream_id","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "log_pattern_buckets_ts_idx" ON "log_pattern_buckets" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "log_pattern_hourly_ts_idx" ON "log_pattern_hourly" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "log_patterns_stream_last_seen_idx" ON "log_patterns" USING btree ("stream_id","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "log_severity_buckets_ts_idx" ON "log_severity_buckets" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "log_severity_hourly_ts_idx" ON "log_severity_hourly" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "log_stream_tokens_hash_uq" ON "log_stream_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "log_stream_tokens_stream_idx" ON "log_stream_tokens" USING btree ("stream_id");