import type { SafeDatabase } from "@checkstack/backend-api";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { ImportantEvent } from "@checkstack/tracestream-common";
import * as schema from "../../schema";
import { traceImportantEvents } from "../../schema";
import type { ImportantEventStore } from "../ports";

type Db = SafeDatabase<typeof schema>;

type EventType = ImportantEvent["type"];

export function createImportantEventStore({
  db,
}: {
  db: Db;
}): ImportantEventStore {
  return {
    async insert(input, options) {
      const id = crypto.randomUUID();
      const createdAt = options?.createdAt ?? new Date();
      await db.insert(traceImportantEvents).values({
        id,
        streamId: input.streamId,
        ts: input.ts,
        type: input.type,
        title: input.title,
        detail: input.detail ?? null,
        createdAt,
      });
      return {
        id,
        streamId: input.streamId,
        ts: input.ts,
        type: input.type,
        title: input.title,
        detail: input.detail ?? null,
        createdAt,
      };
    },

    async list({ streamId, cursor, limit }) {
      const conditions = [eq(traceImportantEvents.streamId, streamId)];
      if (cursor) {
        // Tuple keyset over the (ts DESC, id DESC) order: strictly BEFORE the
        // cursor row. `ts` alone would skip or repeat rows sharing a millisecond
        // (cap/rate events burst at the same ts), so the id breaks the tie.
        conditions.push(
          or(
            lt(traceImportantEvents.ts, cursor.ts),
            and(
              eq(traceImportantEvents.ts, cursor.ts),
              lt(traceImportantEvents.id, cursor.id),
            ),
          )!,
        );
      }
      // Fetch one extra to compute the next cursor without a second query.
      const rows = await db
        .select()
        .from(traceImportantEvents)
        .where(and(...conditions))
        .orderBy(desc(traceImportantEvents.ts), desc(traceImportantEvents.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > limit && last ? { ts: last.ts, id: last.id } : null;
      return {
        events: page.map((row) => ({
          id: row.id,
          streamId: row.streamId,
          ts: row.ts,
          type: row.type,
          title: row.title,
          detail: row.detail,
          createdAt: row.createdAt,
        })),
        nextCursor,
      };
    },

    async lastMarkerByStream({ types }) {
      if (types.length === 0) return new Map<string, string>();
      const rows = await db
        .selectDistinctOn([traceImportantEvents.streamId], {
          streamId: traceImportantEvents.streamId,
          type: traceImportantEvents.type,
        })
        .from(traceImportantEvents)
        .where(inArray(traceImportantEvents.type, types as EventType[]))
        .orderBy(traceImportantEvents.streamId, desc(traceImportantEvents.ts));
      return new Map(rows.map((r) => [r.streamId, r.type as string]));
    },

    async lastEventAt({ streamId, type }) {
      const [row] = await db
        .select({ ts: traceImportantEvents.ts })
        .from(traceImportantEvents)
        .where(
          and(
            eq(traceImportantEvents.streamId, streamId),
            eq(traceImportantEvents.type, type as EventType),
          ),
        )
        .orderBy(desc(traceImportantEvents.ts))
        .limit(1);
      return row?.ts ?? null;
    },

    async deleteBefore({ streamId, cutoff }) {
      await db
        .delete(traceImportantEvents)
        .where(
          and(
            eq(traceImportantEvents.streamId, streamId),
            lt(traceImportantEvents.ts, cutoff),
          ),
        );
    },

    async deleteAllForStream({ streamId }) {
      await db
        .delete(traceImportantEvents)
        .where(eq(traceImportantEvents.streamId, streamId));
    },
  };
}
