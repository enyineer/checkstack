CREATE TABLE "metric_stream_system_links" (
	"stream_id" text NOT NULL,
	"system_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_stream_system_links_stream_id_system_id_pk" PRIMARY KEY("stream_id","system_id")
);
--> statement-breakpoint
CREATE INDEX "metric_stream_system_links_system_idx" ON "metric_stream_system_links" USING btree ("system_id");