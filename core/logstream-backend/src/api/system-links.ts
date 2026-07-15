import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import type { SafeDatabase } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import {
  MAX_SERVICE_NAME_SUGGESTIONS,
  LOGSTREAM_SIGNAL_EVENT_TYPES,
} from "@checkstack/logstream-common";
import type {
  ListSystemLinksResult,
  ListStreamsForSystemResult,
  ListLinkedStreamStatusesResult,
} from "@checkstack/telemetry-common";
import type { ListServiceNamesResult } from "@checkstack/logstream-common";
import type * as schema from "../schema";
import {
  logStreams,
  logStreamSystemLinks,
  logImportantEvents,
  logEvents,
} from "../schema";

/**
 * Only the newest N raw rows (by the `(stream_id, ts, id)` index) are scanned for
 * distinct `service.name` values. `listServiceNames` is a SUGGESTION source for
 * the system-link editor, not an exhaustive catalog: bounding the scan keeps a
 * per-editor-open DISTINCT over the high-volume `log_events` jsonb cheap
 * (optimization.md - bound the query rather than scanning the whole table).
 */
const SERVICE_NAME_SCAN_ROWS = 5000;

/** Recent important events older than this are not signal-worthy for the dashboard. */
const IMPORTANT_EVENT_WINDOW_MS = 24 * 3_600_000;

export interface SystemLinkOperations {
  listSystemLinks(input: { streamId: string }): Promise<ListSystemLinksResult>;
  /**
   * Existence-check-first read for the write path: throws NOT_FOUND for an
   * unknown stream (BEFORE the router runs any catalog round-trip) and returns
   * the currently-persisted link set, so the router can authorize only the
   * ADDED systems. Kept separate from `listSystemLinks` (a plain read) because
   * the write path must fail closed on a missing stream, not return an empty set.
   */
  getSystemLinksForUpdate(input: {
    streamId: string;
  }): Promise<ListSystemLinksResult>;
  /**
   * Replace the stream's linked-system set (full replacement; the editor is a
   * picker, not a patch API). The caller-readability gate ("cannot expose what
   * you cannot see") lives in the ROUTER's injected authorizer over the ADDED
   * subset, so this method only persists.
   */
  setSystemLinks(input: {
    streamId: string;
    systemIds: string[];
  }): Promise<void>;
  listStreamsForSystem(input: {
    systemId: string;
  }): Promise<ListStreamsForSystemResult>;
  listLinkedStreamStatuses(input: {
    systemIds: string[];
  }): Promise<ListLinkedStreamStatusesResult>;
  listServiceNames(input: {
    streamId: string;
  }): Promise<ListServiceNamesResult>;
}

export function createSystemLinkOperations({
  db,
  now = () => new Date(),
}: {
  db: SafeDatabase<typeof schema>;
  now?: () => Date;
}): SystemLinkOperations {
  return {
    async listSystemLinks({ streamId }) {
      const rows = await db
        .select({ systemId: logStreamSystemLinks.systemId })
        .from(logStreamSystemLinks)
        .where(eq(logStreamSystemLinks.streamId, streamId))
        .orderBy(logStreamSystemLinks.systemId);
      return { systemIds: rows.map((r) => r.systemId) };
    },

    async getSystemLinksForUpdate({ streamId }) {
      // Existence first: the junction has no FK, so an insert against a deleted
      // stream would orphan silently. A missing stream fails closed here BEFORE
      // the router makes any catalog round-trip.
      const [stream] = await db
        .select({ id: logStreams.id })
        .from(logStreams)
        .where(eq(logStreams.id, streamId))
        .limit(1);
      if (!stream) {
        throw new ORPCError("NOT_FOUND", { message: "Log stream not found" });
      }
      const rows = await db
        .select({ systemId: logStreamSystemLinks.systemId })
        .from(logStreamSystemLinks)
        .where(eq(logStreamSystemLinks.streamId, streamId));
      return { systemIds: rows.map((r) => r.systemId) };
    },

    async setSystemLinks({ streamId, systemIds }) {
      // De-dupe (a duplicated id in the request is not an extra system). The
      // router already verified existence + authorized the added subset.
      const uniqueSystemIds = [...new Set(systemIds)];
      // Full replacement: clear then re-insert in ONE transaction so a reader
      // never sees a half-applied set.
      await withScopedTransaction(db, async (tx) => {
        await tx
          .delete(logStreamSystemLinks)
          .where(eq(logStreamSystemLinks.streamId, streamId));
        if (uniqueSystemIds.length > 0) {
          await tx
            .insert(logStreamSystemLinks)
            .values(uniqueSystemIds.map((systemId) => ({ streamId, systemId })));
        }
      });
    },

    async listStreamsForSystem({ systemId }) {
      // Join the junction to the streams table so a deleted (but not-yet-swept)
      // link never surfaces a phantom stream; `id` on each row IS the stream id
      // (the field the `listKey` RLAC filter post-filters on).
      const rows = await db
        .select({ id: logStreams.id, name: logStreams.name })
        .from(logStreamSystemLinks)
        .innerJoin(
          logStreams,
          eq(logStreams.id, logStreamSystemLinks.streamId),
        )
        .where(eq(logStreamSystemLinks.systemId, systemId))
        .orderBy(logStreams.name);
      return { streams: rows };
    },

    async listLinkedStreamStatuses({ systemIds }) {
      if (systemIds.length === 0) return { matches: [] };

      // 1) Links for the requested systems, in ONE query. Group them so each
      //    stream restates WHICH of the requested systems it is linked to (the
      //    filler regroups per system).
      const linkRows = await db
        .select({
          streamId: logStreamSystemLinks.streamId,
          systemId: logStreamSystemLinks.systemId,
        })
        .from(logStreamSystemLinks)
        .where(inArray(logStreamSystemLinks.systemId, systemIds));
      if (linkRows.length === 0) return { matches: [] };

      const systemIdsByStream = new Map<string, string[]>();
      for (const row of linkRows) {
        const group = systemIdsByStream.get(row.streamId);
        if (group) group.push(row.systemId);
        else systemIdsByStream.set(row.streamId, [row.systemId]);
      }
      const streamIds = [...systemIdsByStream.keys()];

      // 2) Names for those streams (drops any link whose stream no longer
      //    exists - a phantom is never surfaced).
      const nameRows = await db
        .select({ id: logStreams.id, name: logStreams.name })
        .from(logStreams)
        .where(inArray(logStreams.id, streamIds));

      // 3) Newest recent SIGNAL-WORTHY important event per stream in ONE
      //    set-based query (DISTINCT ON rides the `(stream_id, ts desc)` index;
      //    the ts window bounds the scan). No N+1.
      //
      //    The type filter is LOAD-BEARING: without it, a newer NON-signal event
      //    (e.g. a `new_pattern` minutes after a `spike`) would win the DISTINCT
      //    ON and MASK the spike - exactly while errors surge. Constraining the
      //    lookup to the deriver's signal types (shared constant) means the
      //    newest SIGNAL event is always what surfaces.
      const since = new Date(now().getTime() - IMPORTANT_EVENT_WINDOW_MS);
      const eventRows = await db
        .selectDistinctOn([logImportantEvents.streamId], {
          streamId: logImportantEvents.streamId,
          type: logImportantEvents.type,
          ts: logImportantEvents.ts,
        })
        .from(logImportantEvents)
        .where(
          and(
            inArray(logImportantEvents.streamId, streamIds),
            gte(logImportantEvents.ts, since),
            inArray(logImportantEvents.type, [...LOGSTREAM_SIGNAL_EVENT_TYPES]),
          ),
        )
        .orderBy(
          logImportantEvents.streamId,
          desc(logImportantEvents.ts),
          desc(logImportantEvents.id),
        );
      const eventByStream = new Map(
        eventRows.map((r) => [r.streamId, { type: r.type, ts: r.ts }]),
      );

      return {
        matches: nameRows.map((row) => ({
          id: row.id,
          name: row.name,
          systemIds: systemIdsByStream.get(row.id) ?? [],
          lastImportantEvent: eventByStream.get(row.id) ?? null,
        })),
      };
    },

    async listServiceNames({ streamId }) {
      // Scan only the newest SERVICE_NAME_SCAN_ROWS raw rows (newest-biased via
      // the `(stream_id, ts desc, id desc)` index), then DISTINCT their
      // `service.name` and cap - so a per-editor-open suggestion lookup can
      // never turn into a full-table jsonb DISTINCT (optimization.md).
      const recent = db
        .select({
          serviceName:
            sql<string | null>`${logEvents.resource} ->> 'service.name'`.as(
              "service_name",
            ),
        })
        .from(logEvents)
        .where(eq(logEvents.streamId, streamId))
        .orderBy(desc(logEvents.ts), desc(logEvents.id))
        .limit(SERVICE_NAME_SCAN_ROWS)
        .as("recent");
      const rows = await db
        .selectDistinct({ serviceName: recent.serviceName })
        .from(recent)
        .where(and(isNotNull(recent.serviceName), ne(recent.serviceName, "")))
        .orderBy(recent.serviceName)
        .limit(MAX_SERVICE_NAME_SUGGESTIONS);
      const serviceNames = rows
        .map((r) => r.serviceName)
        .filter((s): s is string => s !== null && s.length > 0);
      return { serviceNames };
    },
  };
}
