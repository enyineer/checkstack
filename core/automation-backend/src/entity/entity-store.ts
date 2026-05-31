/**
 * Framework-owned entity store — the kind-agnostic persistence layer
 * behind every `defineEntity` handle (reactive automation engine §15.1).
 *
 * Kept thin: each method maps to one or two DB statements over the generic
 * `entity_state` + `entity_transitions` tables. The diff / emit / masking
 * orchestration lives in the handle (see `create-handle.ts`); this store
 * only reads and writes rows.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";

import { entityState, entityTransitions } from "../schema";

type Schema = {
  entityState: typeof entityState;
  entityTransitions: typeof entityTransitions;
};

/** A transition row to append when a tracked field changes. */
export interface TransitionAppend {
  field: string;
  fromValue: string | null;
  toValue: string;
}

/** Persisted entity row (validated state lives in `state`). */
export interface EntityRow {
  kind: string;
  entityId: string;
  state: Record<string, unknown>;
  updatedAt: Date;
}

/**
 * The kind-agnostic store. A `defineEntity` handle binds a single `kind`
 * and forwards to these methods.
 */
export interface EntityStore {
  /** Load one entity's current state, or undefined when absent. */
  load(args: {
    kind: string;
    entityId: string;
  }): Promise<Record<string, unknown> | undefined>;

  /** Batched load — mirrors `getBulkHealthState`. Missing ids are omitted. */
  loadMany(args: {
    kind: string;
    entityIds: ReadonlyArray<string>;
  }): Promise<Record<string, Record<string, unknown>>>;

  /**
   * Upsert the validated state and append any transition rows in one
   * transaction, so a reader never sees the new state without its
   * transition log entry (and vice-versa).
   */
  upsert(args: {
    kind: string;
    entityId: string;
    state: Record<string, unknown>;
    transitions: ReadonlyArray<TransitionAppend>;
  }): Promise<void>;

  /** Delete the entity row (tombstone). Transition log is left intact. */
  remove(args: { kind: string; entityId: string }): Promise<void>;

  /**
   * Most-recent transition INTO the entity's current value of `field`,
   * i.e. "in this value since" — the timestamp of the latest row whose
   * `toValue` matches the current state's field value. Null when there is
   * no such transition (e.g. the field never changed since creation).
   */
  inStateSince(args: {
    kind: string;
    entityId: string;
    field: string;
  }): Promise<Date | null>;

  /** Count transitions of `field` within the trailing `windowMs`. */
  transitionCount(args: {
    kind: string;
    entityId: string;
    field: string;
    windowMs: number;
    now: Date;
  }): Promise<number>;
}

/** Serialize a state field value to the transition log's text column. */
export function serializeFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function createEntityStore(db: SafeDatabase<Schema>): EntityStore {
  return {
    async load({ kind, entityId }) {
      const [row] = await db
        .select()
        .from(entityState)
        .where(
          and(eq(entityState.kind, kind), eq(entityState.entityId, entityId)),
        )
        .limit(1);
      return row?.state;
    },

    async loadMany({ kind, entityIds }) {
      if (entityIds.length === 0) return {};
      const rows = await db
        .select()
        .from(entityState)
        .where(
          and(
            eq(entityState.kind, kind),
            inArray(entityState.entityId, [...entityIds]),
          ),
        );
      const out: Record<string, Record<string, unknown>> = {};
      for (const row of rows) out[row.entityId] = row.state;
      return out;
    },

    async upsert({ kind, entityId, state, transitions }) {
      await db.transaction(async (tx) => {
        await tx
          .insert(entityState)
          .values({ kind, entityId, state, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [entityState.kind, entityState.entityId],
            set: { state, updatedAt: new Date() },
          });
        if (transitions.length > 0) {
          await tx.insert(entityTransitions).values(
            transitions.map((t) => ({
              kind,
              entityId,
              field: t.field,
              fromValue: t.fromValue,
              toValue: t.toValue,
            })),
          );
        }
      });
    },

    async remove({ kind, entityId }) {
      await db
        .delete(entityState)
        .where(
          and(eq(entityState.kind, kind), eq(entityState.entityId, entityId)),
        );
    },

    async inStateSince({ kind, entityId, field }) {
      // Read the current value of `field`, then find the most recent
      // transition INTO that value. Two cheap indexed reads.
      const current = await this.load({ kind, entityId });
      if (current === undefined) return null;
      const value = serializeFieldValue(current[field]);
      const [row] = await db
        .select({ transitionedAt: entityTransitions.transitionedAt })
        .from(entityTransitions)
        .where(
          and(
            eq(entityTransitions.kind, kind),
            eq(entityTransitions.entityId, entityId),
            eq(entityTransitions.field, field),
            eq(entityTransitions.toValue, value),
          ),
        )
        .orderBy(desc(entityTransitions.transitionedAt))
        .limit(1);
      return row?.transitionedAt ?? null;
    },

    async transitionCount({ kind, entityId, field, windowMs, now }) {
      const since = new Date(now.getTime() - windowMs);
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(entityTransitions)
        .where(
          and(
            eq(entityTransitions.kind, kind),
            eq(entityTransitions.entityId, entityId),
            eq(entityTransitions.field, field),
            gte(entityTransitions.transitionedAt, since),
          ),
        );
      return row?.count ?? 0;
    },
  };
}
