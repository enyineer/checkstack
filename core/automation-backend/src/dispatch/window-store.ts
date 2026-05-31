/**
 * Drizzle-backed implementation of `WindowStore` — the windowed-count / rate
 * trigger occurrence log. Kept thin: each method maps almost 1:1 to a DB
 * statement, mirroring `dwell-store.ts`.
 *
 * The append log is the source of truth. `recordAndCount` does the proven
 * "insert one row, then COUNT(*) within the trailing window" shape (relocated
 * from the former healthcheck flapping detector) so the gate is durable and
 * pod-independent: the INSERT runs once on the pod that claimed the emission
 * from the work queue, and the COUNT is pure SQL so every pod computes the
 * same total.
 */
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";

import { automationWindowEvents } from "../schema";
import type { RecordWindowInput, WindowStore } from "./types";

type Schema = { automationWindowEvents: typeof automationWindowEvents };

/** Build the `(automationId, triggerId, contextKey)` match predicate. */
function keyWhere(
  automationId: string,
  triggerId: string,
  contextKey: string | null,
) {
  return and(
    eq(automationWindowEvents.automationId, automationId),
    eq(automationWindowEvents.triggerId, triggerId),
    contextKey === null
      ? isNull(automationWindowEvents.contextKey)
      : eq(automationWindowEvents.contextKey, contextKey),
  );
}

export function createWindowStore(db: SafeDatabase<Schema>): WindowStore {
  return {
    async recordAndCount(input: RecordWindowInput): Promise<boolean> {
      const {
        automationId,
        triggerId,
        eventId,
        contextKey,
        occurredAt,
        windowMinutes,
        threshold,
        refire,
      } = input;

      // (1) Append the qualifying occurrence. One INSERT per claimed emission,
      // so the count below can't double-count across pods.
      await db.insert(automationWindowEvents).values({
        automationId,
        triggerId,
        eventId,
        contextKey,
        occurredAt,
      });

      // (2) Count rows in the trailing window (inclusive of the row just
      // inserted) — a pure DB read, identical on every pod.
      const windowStart = new Date(
        occurredAt.getTime() - windowMinutes * 60_000,
      );
      const result = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(automationWindowEvents)
        .where(
          and(
            keyWhere(automationId, triggerId, contextKey),
            gte(automationWindowEvents.occurredAt, windowStart),
          ),
        );
      const newCount = result[0]?.count ?? 0;

      // (3) Apply the re-fire policy.
      //  - `every`: fire on every occurrence at/over the threshold.
      //  - `once`: fire only on the crossing edge (newCount === threshold);
      //    re-arms naturally as old rows age out and the count re-crosses.
      //
      // At-least-once caveat: if the work queue redelivers an emission, the
      // same logical occurrence inserts twice and the count can skip the exact
      // `=== threshold` edge, so `once` may miss a fire. This is best-effort,
      // fail-open (matching the dwell re-confirm posture) — `every` is
      // redelivery-tolerant; pick `once` knowing the trade-off.
      if (refire === "once") return newCount === threshold;
      return newCount >= threshold;
    },

    async sweepExpired(cutoff: Date): Promise<void> {
      await db
        .delete(automationWindowEvents)
        .where(lt(automationWindowEvents.occurredAt, cutoff));
    },

    async deleteForAutomation(automationId: string): Promise<void> {
      await db
        .delete(automationWindowEvents)
        .where(eq(automationWindowEvents.automationId, automationId));
    },
  };
}
