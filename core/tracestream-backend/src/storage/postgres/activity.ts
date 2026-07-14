import type { ScopedQueryRunner } from "@checkstack/backend-api";
import { eq, inArray, sql } from "drizzle-orm";
import * as schema from "../../schema";
import { traceStreamActivity } from "../../schema";
import type { ActivityStore, TraceStreamActivity } from "../ports";

type Runner = ScopedQueryRunner<typeof schema>;

export function createActivityStore({ runner }: { runner: Runner }): ActivityStore {
  return {
    async touch({
      streamId,
      receivedAt,
      rateEstimate,
      droppedSpans = 0,
      droppedTraces = 0,
    }) {
      await runner
        .insert(traceStreamActivity)
        .values({
          streamId,
          lastReceivedAt: receivedAt,
          approxSpansPerMinute: Math.round(rateEstimate),
          droppedSpansCount: droppedSpans,
          droppedTracesCount: droppedTraces,
        })
        .onConflictDoUpdate({
          target: [traceStreamActivity.streamId],
          set: {
            lastReceivedAt: sql`greatest(${traceStreamActivity.lastReceivedAt}, excluded.last_received_at)`,
            approxSpansPerMinute: sql`excluded.approx_spans_per_minute`,
            droppedSpansCount: sql`${traceStreamActivity.droppedSpansCount} + excluded.dropped_spans_count`,
            droppedTracesCount: sql`${traceStreamActivity.droppedTracesCount} + excluded.dropped_traces_count`,
          },
        });
    },

    async read({ streamId }) {
      const [row] = await runner
        .select()
        .from(traceStreamActivity)
        .where(eq(traceStreamActivity.streamId, streamId))
        .limit(1);
      if (!row) return null;
      return {
        streamId: row.streamId,
        lastReceivedAt: row.lastReceivedAt,
        approxSpansPerMinute: Number(row.approxSpansPerMinute),
        droppedSpansCount: Number(row.droppedSpansCount),
        droppedTracesCount: Number(row.droppedTracesCount),
      } satisfies TraceStreamActivity;
    },

    async listActivity() {
      return runner
        .select({
          streamId: traceStreamActivity.streamId,
          lastReceivedAt: traceStreamActivity.lastReceivedAt,
        })
        .from(traceStreamActivity);
    },

    async lastReceivedForStreams({ streamIds }) {
      const out = new Map<string, Date | null>();
      if (streamIds.length === 0) return out;
      const rows = await runner
        .select({
          streamId: traceStreamActivity.streamId,
          lastReceivedAt: traceStreamActivity.lastReceivedAt,
        })
        .from(traceStreamActivity)
        .where(inArray(traceStreamActivity.streamId, streamIds));
      for (const row of rows) out.set(row.streamId, row.lastReceivedAt);
      return out;
    },

    async deleteAllForStream({ streamId }) {
      await runner
        .delete(traceStreamActivity)
        .where(eq(traceStreamActivity.streamId, streamId));
    },
  };
}
