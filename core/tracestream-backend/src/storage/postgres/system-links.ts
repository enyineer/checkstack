import type { SafeDatabase } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import type {
  LinkedStream,
  LinkedStreamStatus,
} from "@checkstack/telemetry-common";
import { TRACESTREAM_SIGNAL_EVENT_TYPES } from "@checkstack/tracestream-common";
import * as schema from "../../schema";
import {
  traceImportantEvents,
  traceStreamSystemLinks,
  traceStreams,
} from "../../schema";
import type { SystemLinkStore } from "../ports";

type Db = SafeDatabase<typeof schema>;

/**
 * Explicit stream -> catalog-system link store. FK-less like every other table
 * (schema-scoped): `systemId` is a bare catalog id, `streamId` references
 * `trace_streams` only by convention. All reads join `trace_streams` (same
 * schema) for the stream name. `listLinkedStreamStatuses` folds the events set
 * with a single DISTINCT ON (never a per-stream query - see optimization.md).
 */
export function createSystemLinkStore({ db }: { db: Db }): SystemLinkStore {
  return {
    async listSystemIdsForStream({ streamId }) {
      const rows = await db
        .select({ systemId: traceStreamSystemLinks.systemId })
        .from(traceStreamSystemLinks)
        .where(eq(traceStreamSystemLinks.streamId, streamId))
        .orderBy(asc(traceStreamSystemLinks.systemId));
      return rows.map((r) => r.systemId);
    },

    async setSystemLinks({ streamId, systemIds }) {
      // Replace-all in ONE transaction: delete the stream's whole set, then
      // insert the new one (deduped by the caller's picker; the PK also collapses
      // any residual duplicate). Either the new set commits whole or not at all.
      const unique = [...new Set(systemIds)];
      await withScopedTransaction(db, async (tx) => {
        await tx
          .delete(traceStreamSystemLinks)
          .where(eq(traceStreamSystemLinks.streamId, streamId));
        if (unique.length > 0) {
          await tx
            .insert(traceStreamSystemLinks)
            .values(unique.map((systemId) => ({ streamId, systemId })))
            .onConflictDoNothing();
        }
      });
    },

    async listStreamsForSystem({ systemId }) {
      const rows = await db
        .select({ id: traceStreams.id, name: traceStreams.name })
        .from(traceStreamSystemLinks)
        .innerJoin(
          traceStreams,
          eq(traceStreams.id, traceStreamSystemLinks.streamId),
        )
        .where(eq(traceStreamSystemLinks.systemId, systemId))
        .orderBy(asc(traceStreams.name));
      return rows.map((r): LinkedStream => ({ id: r.id, name: r.name }));
    },

    async listLinkedStreamStatuses({ systemIds, since }) {
      if (systemIds.length === 0) return [];
      // 1. Every (stream, requested-system) link, in one query. Group per stream
      //    so the filler can regroup by system without a second round-trip.
      const linkRows = await db
        .select({
          streamId: traceStreamSystemLinks.streamId,
          systemId: traceStreamSystemLinks.systemId,
        })
        .from(traceStreamSystemLinks)
        .where(inArray(traceStreamSystemLinks.systemId, systemIds));
      if (linkRows.length === 0) return [];
      const systemsByStream = new Map<string, string[]>();
      for (const row of linkRows) {
        const list = systemsByStream.get(row.streamId);
        if (list) list.push(row.systemId);
        else systemsByStream.set(row.streamId, [row.systemId]);
      }
      const streamIds = [...systemsByStream.keys()];
      // 2. Stream names for the linked set (one query). Building the result from
      //    THESE rows (not the link keys) drops any link whose stream row is gone
      //    - a phantom (a raw-UUID 404-link after a partial delete) is never
      //    surfaced.
      const nameRows = await db
        .select({ id: traceStreams.id, name: traceStreams.name })
        .from(traceStreams)
        .where(inArray(traceStreams.id, streamIds));
      // 3. Newest recent SIGNAL-WORTHY event within [since, now) per stream: ONE
      //    DISTINCT ON over the events table. The type filter is the masking fix
      //    - a newer NON-signal event (e.g. rate_limited) must not shadow an
      //    error_spike the dashboard needs. The desc(id) tiebreak makes the pick
      //    deterministic across refetches when events share a millisecond.
      const eventRows = await db
        .selectDistinctOn([traceImportantEvents.streamId], {
          streamId: traceImportantEvents.streamId,
          type: traceImportantEvents.type,
          ts: traceImportantEvents.ts,
        })
        .from(traceImportantEvents)
        .where(
          and(
            inArray(traceImportantEvents.streamId, streamIds),
            inArray(traceImportantEvents.type, [
              ...TRACESTREAM_SIGNAL_EVENT_TYPES,
            ]),
            gte(traceImportantEvents.ts, since),
          ),
        )
        .orderBy(
          traceImportantEvents.streamId,
          desc(traceImportantEvents.ts),
          desc(traceImportantEvents.id),
        );
      const eventByStream = new Map(
        eventRows.map((r) => [r.streamId, { type: r.type, ts: r.ts }]),
      );
      return nameRows.map(
        (row): LinkedStreamStatus => ({
          id: row.id,
          name: row.name,
          systemIds: systemsByStream.get(row.id) ?? [],
          lastImportantEvent: eventByStream.get(row.id) ?? null,
        }),
      );
    },

    async deleteAllForStream({ streamId }) {
      await db
        .delete(traceStreamSystemLinks)
        .where(eq(traceStreamSystemLinks.streamId, streamId));
    },
  };
}
