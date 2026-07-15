CREATE TABLE "trace_important_events" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_op_hourly_buckets" (
	"stream_id" text NOT NULL,
	"service_name" text NOT NULL,
	"span_name" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"span_count" bigint DEFAULT 0 NOT NULL,
	"error_count" bigint DEFAULT 0 NOT NULL,
	"dur_sum_ms" double precision DEFAULT 0 NOT NULL,
	"dur_min_ms" double precision,
	"dur_max_ms" double precision,
	"digest" jsonb,
	CONSTRAINT "trace_op_hourly_buckets_stream_id_service_name_span_name_bucket_start_pk" PRIMARY KEY("stream_id","service_name","span_name","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "trace_op_minute_buckets" (
	"stream_id" text NOT NULL,
	"service_name" text NOT NULL,
	"span_name" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"span_count" bigint DEFAULT 0 NOT NULL,
	"error_count" bigint DEFAULT 0 NOT NULL,
	"dur_sum_ms" double precision DEFAULT 0 NOT NULL,
	"dur_min_ms" double precision,
	"dur_max_ms" double precision,
	"digest" jsonb,
	CONSTRAINT "trace_op_minute_buckets_stream_id_service_name_span_name_bucket_start_pk" PRIMARY KEY("stream_id","service_name","span_name","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "trace_service_ops" (
	"stream_id" text NOT NULL,
	"service_name" text NOT NULL,
	"span_name" text NOT NULL,
	"kind" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trace_service_ops_stream_id_service_name_span_name_pk" PRIMARY KEY("stream_id","service_name","span_name")
);
--> statement-breakpoint
CREATE TABLE "trace_spans" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trace_spans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stream_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"span_id" text NOT NULL,
	"parent_span_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"service_name" text,
	"start_ts" timestamp with time zone NOT NULL,
	"duration_ms" double precision NOT NULL,
	"status_code" text NOT NULL,
	"status_message" text,
	"attributes" jsonb,
	"events" jsonb,
	"links" jsonb,
	"resource_attributes" jsonb
);
--> statement-breakpoint
CREATE TABLE "trace_stream_activity" (
	"stream_id" text PRIMARY KEY NOT NULL,
	"last_received_at" timestamp with time zone,
	"approx_spans_per_minute" bigint DEFAULT 0 NOT NULL,
	"dropped_spans_count" bigint DEFAULT 0 NOT NULL,
	"dropped_traces_count" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_stream_tokens" (
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
CREATE TABLE "trace_streams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_summaries" (
	"stream_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"root_service_name" text,
	"root_span_name" text,
	"start_ts" timestamp with time zone NOT NULL,
	"duration_ms" double precision NOT NULL,
	"span_count" integer DEFAULT 0 NOT NULL,
	"error_span_count" integer DEFAULT 0 NOT NULL,
	"has_error" boolean DEFAULT false NOT NULL,
	"retained" boolean,
	"decided_at" timestamp with time zone,
	"last_span_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trace_summaries_stream_id_trace_id_pk" PRIMARY KEY("stream_id","trace_id")
);
--> statement-breakpoint
CREATE INDEX "trace_important_events_stream_ts_idx" ON "trace_important_events" USING btree ("stream_id","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trace_op_hourly_buckets_ts_idx" ON "trace_op_hourly_buckets" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "trace_op_hourly_buckets_stream_ts_idx" ON "trace_op_hourly_buckets" USING btree ("stream_id","bucket_start");--> statement-breakpoint
CREATE INDEX "trace_op_minute_buckets_ts_idx" ON "trace_op_minute_buckets" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "trace_op_minute_buckets_stream_ts_idx" ON "trace_op_minute_buckets" USING btree ("stream_id","bucket_start");--> statement-breakpoint
CREATE INDEX "trace_service_ops_stream_service_idx" ON "trace_service_ops" USING btree ("stream_id","service_name");--> statement-breakpoint
CREATE INDEX "trace_service_ops_stream_last_seen_idx" ON "trace_service_ops" USING btree ("stream_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "trace_spans_stream_trace_idx" ON "trace_spans" USING btree ("stream_id","trace_id");--> statement-breakpoint
CREATE INDEX "trace_spans_stream_start_idx" ON "trace_spans" USING btree ("stream_id","start_ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trace_stream_tokens_hash_uq" ON "trace_stream_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "trace_stream_tokens_stream_idx" ON "trace_stream_tokens" USING btree ("stream_id");--> statement-breakpoint
CREATE INDEX "trace_summaries_stream_start_idx" ON "trace_summaries" USING btree ("stream_id","start_ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trace_summaries_decision_idx" ON "trace_summaries" USING btree ("stream_id","retained","last_span_at");--> statement-breakpoint
CREATE INDEX "trace_summaries_trace_idx" ON "trace_summaries" USING btree ("trace_id");