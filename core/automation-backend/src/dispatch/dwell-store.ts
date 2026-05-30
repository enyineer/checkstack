/**
 * Drizzle-backed implementation of `DwellStore` — pre-run `for:` dwell
 * timers. Kept thin: each method maps almost 1:1 to a DB statement. The
 * row is the source of truth; the queue job is just the wake signal and
 * cancellation is a row delete (constraint 2).
 */
import { and, eq, isNull, lte } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";

import { automationDwellTimers } from "../schema";
import type { DwellStore, LoadedDwell, UpsertDwellInput } from "./types";

type Schema = { automationDwellTimers: typeof automationDwellTimers };

function mapRow(row: typeof automationDwellTimers.$inferSelect): LoadedDwell {
  return {
    id: row.id,
    automationId: row.automationId,
    triggerId: row.triggerId,
    eventId: row.eventId,
    contextKey: row.contextKey,
    armedStatus: row.armedStatus,
    payloadSnapshot: row.payloadSnapshot,
    actorSnapshot: row.actorSnapshot,
    fireAt: row.fireAt,
    createdAt: row.createdAt,
  };
}

/** Build the `(automationId, triggerId, contextKey)` match predicate. */
function keyWhere(
  automationId: string,
  triggerId: string,
  contextKey: string | null,
) {
  return and(
    eq(automationDwellTimers.automationId, automationId),
    eq(automationDwellTimers.triggerId, triggerId),
    contextKey === null
      ? isNull(automationDwellTimers.contextKey)
      : eq(automationDwellTimers.contextKey, contextKey),
  );
}

export function createDwellStore(db: SafeDatabase<Schema>): DwellStore {
  return {
    async upsert(input: UpsertDwellInput): Promise<string> {
      const set = {
        eventId: input.eventId,
        armedStatus: input.armedStatus,
        payloadSnapshot: input.payloadSnapshot,
        actorSnapshot: input.actorSnapshot,
        fireAt: input.fireAt,
      };

      // Null context keys are "distinct" to a Postgres unique index, so
      // ON CONFLICT would never match them and duplicate null-key dwells
      // would stack. Handle that case with an explicit find-then-update.
      if (input.contextKey === null) {
        const [existing] = await db
          .select({ id: automationDwellTimers.id })
          .from(automationDwellTimers)
          .where(keyWhere(input.automationId, input.triggerId, null))
          .limit(1);
        if (existing) {
          await db
            .update(automationDwellTimers)
            .set(set)
            .where(eq(automationDwellTimers.id, existing.id));
          return existing.id;
        }
      }

      const [row] = await db
        .insert(automationDwellTimers)
        .values({
          automationId: input.automationId,
          triggerId: input.triggerId,
          eventId: input.eventId,
          contextKey: input.contextKey,
          armedStatus: input.armedStatus,
          payloadSnapshot: input.payloadSnapshot,
          actorSnapshot: input.actorSnapshot,
          fireAt: input.fireAt,
        })
        .onConflictDoUpdate({
          target: [
            automationDwellTimers.automationId,
            automationDwellTimers.triggerId,
            automationDwellTimers.contextKey,
          ],
          set,
        })
        .returning({ id: automationDwellTimers.id });
      if (!row) throw new Error("upsert dwell: insert returned no rows");
      return row.id;
    },

    async load(id) {
      const [row] = await db
        .select()
        .from(automationDwellTimers)
        .where(eq(automationDwellTimers.id, id))
        .limit(1);
      return row ? mapRow(row) : undefined;
    },

    async findByKey(automationId, triggerId, contextKey) {
      const [row] = await db
        .select()
        .from(automationDwellTimers)
        .where(keyWhere(automationId, triggerId, contextKey))
        .limit(1);
      return row ? mapRow(row) : undefined;
    },

    async delete(id) {
      await db
        .delete(automationDwellTimers)
        .where(eq(automationDwellTimers.id, id));
    },

    async deleteByKey(automationId, triggerId, contextKey) {
      await db
        .delete(automationDwellTimers)
        .where(keyWhere(automationId, triggerId, contextKey));
    },

    async deleteForAutomation(automationId) {
      await db
        .delete(automationDwellTimers)
        .where(eq(automationDwellTimers.automationId, automationId));
    },

    async sweepExpired(now) {
      const rows = await db
        .select()
        .from(automationDwellTimers)
        .where(lte(automationDwellTimers.fireAt, now));
      return rows.map((row) => mapRow(row));
    },
  };
}
