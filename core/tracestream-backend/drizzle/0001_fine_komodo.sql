DROP INDEX "trace_spans_stream_trace_idx";--> statement-breakpoint
-- At-least-once ingest under the old non-unique index may have stored duplicate
-- (stream_id, trace_id, span_id) rows; collapse them (keep the lowest id) so the
-- unique index below can be created on an already-populated database.
DELETE FROM "trace_spans" AS x
USING "trace_spans" AS y
WHERE x."stream_id" = y."stream_id"
  AND x."trace_id" = y."trace_id"
  AND x."span_id" = y."span_id"
  AND x."id" > y."id";--> statement-breakpoint
CREATE UNIQUE INDEX "trace_spans_stream_trace_span_uq" ON "trace_spans" USING btree ("stream_id","trace_id","span_id");