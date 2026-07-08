/**
 * Drizzle-backed implementation of `DwellStore` — pre-run `for:` dwell
 * timers. Kept thin: each method maps almost 1:1 to a DB statement. The
 * row is the source of truth; the queue job is just the wake signal and
 * cancellation is a row delete (constraint 2).
 */
import { and, eq, isNull, lte } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";

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
    async arm(input: UpsertDwellInput) {
      // Insert-if-absent. A dwell already armed for this key is preserved
      // UNCHANGED — its original `fireAt` stands so the `for:` window
      // measures "continuously matched since first arm", not "since the
      // most recent matching event". (A genuine recover-then-recur deletes
      // the row first via inverse-cancel / re-confirm, starting fresh.)

      // The existence check, the insert-if-absent, and the lost-race re-read
      // run under one SET LOCAL search_path (a single transaction) instead of
      // up to three standalone scoped queries. The unique-index ON CONFLICT
      // still serializes concurrent arms at the DB level (a competing arm is a
      // separate transaction), so the idempotent semantics are unchanged.
      return withScopedTransaction(db, async (tx) => {
        // Fast path: if a row already exists for the key, return it untouched.
        // (Also covers the null-context-key case where ON CONFLICT can't
        // match, since NULLs are distinct in a Postgres unique index.)
        const [existing] = await tx
          .select()
          .from(automationDwellTimers)
          .where(
            keyWhere(input.automationId, input.triggerId, input.contextKey),
          )
          .limit(1);
        if (existing) {
          return { id: existing.id, created: false, fireAt: existing.fireAt };
        }

        // No row yet — INSERT. ON CONFLICT DO NOTHING guards the race where a
        // concurrent arm inserted between our SELECT and INSERT; in that case
        // `returning` is empty and we re-read the winner's row.
        const [row] = await tx
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
          .onConflictDoNothing({
            target: [
              automationDwellTimers.automationId,
              automationDwellTimers.triggerId,
              automationDwellTimers.contextKey,
            ],
          })
          .returning();
        if (row) {
          return { id: row.id, created: true, fireAt: row.fireAt };
        }

        // Lost the race — another arm won. Re-read the existing row.
        const [winner] = await tx
          .select()
          .from(automationDwellTimers)
          .where(
            keyWhere(input.automationId, input.triggerId, input.contextKey),
          )
          .limit(1);
        if (!winner) throw new Error("arm dwell: row vanished after conflict");
        return { id: winner.id, created: false, fireAt: winner.fireAt };
      });
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
      // `RETURNING id` makes the delete an atomic claim: exactly one
      // concurrent caller sees a returned row (the row the DB actually
      // removed), every other caller gets an empty result. `fireDwell`
      // relies on this so two pods (or the sweeper vs the queue consumer)
      // can't both fire the same dwell.
      const deleted = await db
        .delete(automationDwellTimers)
        .where(eq(automationDwellTimers.id, id))
        .returning({ id: automationDwellTimers.id });
      return deleted.length > 0;
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
