CREATE TABLE "trace_stream_system_links" (
	"stream_id" text NOT NULL,
	"system_id" text NOT NULL,
	CONSTRAINT "trace_stream_system_links_stream_id_system_id_pk" PRIMARY KEY("stream_id","system_id")
);
--> statement-breakpoint
CREATE INDEX "trace_stream_system_links_system_idx" ON "trace_stream_system_links" USING btree ("system_id");