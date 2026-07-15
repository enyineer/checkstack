import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import type { SafeDatabase } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import { METRICSTREAM_SIGNAL_EVENT_TYPES } from "@checkstack/metricstream-common";
import type {
  ListSystemLinksResult,
  ListStreamsForSystemResult,
  ListLinkedStreamStatusesResult,
} from "@checkstack/telemetry-common";
import type * as schema from "../schema";
import {
  metricStreams,
  metricStreamSystemLinks,
  metricImportantEvents,
} from "../schema";

/** Recent important events older than this are not signal-worthy for the dashboard. */
const IMPORTANT_EVENT_WINDOW_MS = 24 * 3_600_000;

/**
 * Readability gate over the NEWLY ADDED system ids (already diffed against the
 * persisted set). Injected so `setSystemLinks` runs the "cannot expose what you
 * cannot see" check without depending on the transport. No-op for an empty set.
 */
export type AssertAddedSystemsReadable = (
  addedSystemIds: string[],
) => Promise<void>;

/**
 * Explicit stream -> catalog-system link operations (shared telemetry contract;
 * see `@checkstack/telemetry-common`'s `system-links.ts`). Mirrors logstream's
 * `createSystemLinkOperations` shape so the three stream plugins cannot drift.
 */
export interface SystemLinkOperations {
  listSystemLinks(input: { streamId: string }): Promise<ListSystemLinksResult>;
  /**
   * Replace the stream's linked-system set. Existence is checked FIRST (NOT_FOUND
   * before any catalog round-trip); then only the NEWLY ADDED systems (the diff
   * against the persisted set) are passed to `assertAddedReadable` - retained /
   * removed ids need no readability, so a manager is never dead-locked by a link
   * someone else authorized.
   */
  setSystemLinks(input: {
    streamId: string;
    systemIds: string[];
    assertAddedReadable: AssertAddedSystemsReadable;
  }): Promise<void>;
  listStreamsForSystem(input: {
    systemId: string;
  }): Promise<ListStreamsForSystemResult>;
  listLinkedStreamStatuses(input: {
    systemIds: string[];
  }): Promise<ListLinkedStreamStatusesResult>;
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
        .select({ systemId: metricStreamSystemLinks.systemId })
        .from(metricStreamSystemLinks)
        .where(eq(metricStreamSystemLinks.streamId, streamId))
        .orderBy(metricStreamSystemLinks.systemId);
      return { systemIds: rows.map((r) => r.systemId) };
    },

    async setSystemLinks({ streamId, systemIds, assertAddedReadable }) {
      // Existence-check FIRST: NOT_FOUND before any catalog round-trip. The
      // junction has no FK, so an insert against a deleted stream would orphan
      // silently.
      const [stream] = await db
        .select({ id: metricStreams.id })
        .from(metricStreams)
        .where(eq(metricStreams.id, streamId))
        .limit(1);
      if (!stream) {
        throw new ORPCError("NOT_FOUND", { message: "Metric stream not found" });
      }

      // De-dupe (a duplicated id in the request is not an extra system).
      const requested = [...new Set(systemIds)];

      // Diff against the currently persisted set: only the NEWLY ADDED systems
      // need a readability check (retained/removed need none - a manager who
      // cannot read a link someone else added must still be able to save).
      const persistedRows = await db
        .select({ systemId: metricStreamSystemLinks.systemId })
        .from(metricStreamSystemLinks)
        .where(eq(metricStreamSystemLinks.streamId, streamId));
      const persisted = new Set(persistedRows.map((r) => r.systemId));
      const added = requested.filter((id) => !persisted.has(id));

      // Gate ONLY the additions BEFORE persisting (the authorizer skips the
      // catalog round-trip when `added` is empty).
      await assertAddedReadable(added);

      // Full replacement (the editor is a picker, not a patch API): clear then
      // re-insert in ONE transaction so a reader never sees a half-applied set.
      await withScopedTransaction(db, async (tx) => {
        await tx
          .delete(metricStreamSystemLinks)
          .where(eq(metricStreamSystemLinks.streamId, streamId));
        if (requested.length > 0) {
          await tx
            .insert(metricStreamSystemLinks)
            .values(requested.map((systemId) => ({ streamId, systemId })));
        }
      });
    },

    async listStreamsForSystem({ systemId }) {
      // Join the junction to the streams table so a deleted (but not-yet-swept)
      // link never surfaces a phantom stream; `id` on each row IS the stream id
      // (the field the `listKey` RLAC filter post-filters on).
      const rows = await db
        .select({ id: metricStreams.id, name: metricStreams.name })
        .from(metricStreamSystemLinks)
        .innerJoin(
          metricStreams,
          eq(metricStreams.id, metricStreamSystemLinks.streamId),
        )
        .where(eq(metricStreamSystemLinks.systemId, systemId))
        .orderBy(metricStreams.name);
      return { streams: rows };
    },

    async listLinkedStreamStatuses({ systemIds }) {
      if (systemIds.length === 0) return { matches: [] };

      // 1) Links for the requested systems, in ONE query. Group them so each
      //    stream restates WHICH of the requested systems it is linked to (the
      //    filler regroups per system).
      const linkRows = await db
        .select({
          streamId: metricStreamSystemLinks.streamId,
          systemId: metricStreamSystemLinks.systemId,
        })
        .from(metricStreamSystemLinks)
        .where(inArray(metricStreamSystemLinks.systemId, systemIds));
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
        .select({ id: metricStreams.id, name: metricStreams.name })
        .from(metricStreams)
        .where(inArray(metricStreams.id, streamIds));

      // 3) Newest RECENT SIGNAL-WORTHY important event per stream in ONE
      //    set-based query (DISTINCT ON rides the `(stream_id, ts desc)` index;
      //    the ts window bounds the scan). No N+1.
      //
      //    The type filter is LOAD-BEARING, not cosmetic: without it the newest
      //    event of ANY type wins, so a benign `silence_recovered` a minute after
      //    a `scrape_failing` would MASK the active failure (the deriver would
      //    see the recovery and emit nothing). Constraining the lookup to the
      //    dashboard's signal-worthy types (the SINGLE SOURCE OF TRUTH shared
      //    with the frontend `deriveMetricstreamSignals`) means the newest
      //    SIGNAL event surfaces instead. See metricstream-common's
      //    `signal-event-types.ts`.
      const since = new Date(now().getTime() - IMPORTANT_EVENT_WINDOW_MS);
      const eventRows = await db
        .selectDistinctOn([metricImportantEvents.streamId], {
          streamId: metricImportantEvents.streamId,
          type: metricImportantEvents.type,
          ts: metricImportantEvents.ts,
        })
        .from(metricImportantEvents)
        .where(
          and(
            inArray(metricImportantEvents.streamId, streamIds),
            gte(metricImportantEvents.ts, since),
            inArray(metricImportantEvents.type, [
              ...METRICSTREAM_SIGNAL_EVENT_TYPES,
            ]),
          ),
        )
        .orderBy(
          metricImportantEvents.streamId,
          desc(metricImportantEvents.ts),
          desc(metricImportantEvents.id),
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
  };
}
