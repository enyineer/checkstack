/**
 * Framework transition store — the kind-agnostic, plugin-storage-agnostic
 * persistence layer behind every `defineEntity` handle (Model B, reactive
 * automation engine §15.1 reshaped).
 *
 * In Model B `defineEntity` owns NO current-state storage of its own. The
 * plugin owns its state and reads it through a `read` accessor; this store
 * owns only two universal concerns:
 *
 *   1. The TRANSACTION the handle drives `apply` inside, so the plugin's
 *      reactive-state write and the framework `entity_transitions` append
 *      commit atomically together (`runInTransaction` + tx-aware
 *      `appendTransitions`). This makes "every change is logged" a structural
 *      guarantee, regardless of where current state lives (even an in-memory
 *      kind gets durable platform history).
 *   2. The transition-LOG read helpers (`inStateSince` / `transitionCount`)
 *      that power `inStateSince` / `inStateForMs` / `transitionCount`.
 *
 * The optional `entity_state` keyed store (for homeless kinds) lives in
 * `create-keyed-store.ts`; it plugs in through the handle's `read` + `apply`
 * like any other plugin storage.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";

import { entityState, entityTransitions } from "../schema";

type Schema = {
  entityState: typeof entityState;
  entityTransitions: typeof entityTransitions;
};

/**
 * The transaction handle the store opens and the handle passes to `apply`.
 * It is the drizzle transaction object for the automation-backend schema —
 * opaque to the handle, used by the plugin's `apply` (and the framework
 * keyed store) to write atomically with the transition append.
 */
export type EntityTx = Parameters<
  Parameters<SafeDatabase<Schema>["transaction"]>[0]
>[0];

/** A transition row to append when a tracked field changes. */
export interface TransitionAppend {
  field: string;
  fromValue: string | null;
  toValue: string;
}

/**
 * The kind-agnostic transition store. A `defineEntity` handle binds a single
 * `kind` and forwards to these methods.
 */
export interface EntityStore {
  /**
   * Run `fn` inside ONE database transaction, passing it the transaction
   * handle. The handle uses this to compose the plugin's `apply` write with
   * the framework transition append: both happen on the same `tx` so they
   * commit or roll back together. The post-commit change emit is done by the
   * handle AFTER this resolves.
   */
  runInTransaction<R>(fn: (tx: EntityTx) => Promise<R>): Promise<R>;

  /**
   * Append transition rows on an EXISTING transaction (the one the handle is
   * driving `apply` inside), so the rows commit atomically with the plugin's
   * reactive-state write.
   */
  appendTransitions(args: {
    tx: EntityTx;
    kind: string;
    entityId: string;
    transitions: ReadonlyArray<TransitionAppend>;
  }): Promise<void>;

  /**
   * Most-recent transition INTO `currentValue` for `field`, i.e. "in this
   * value since" — the timestamp of the latest row whose `toValue` matches
   * the entity's CURRENT field value (resolved by the handle via `read`).
   * Null when there is no such transition (e.g. the field never changed
   * since creation, or the entity is absent and the handle passes no value).
   */
  inStateSince(args: {
    kind: string;
    entityId: string;
    field: string;
    /** The entity's current value of `field`, resolved by the handle. */
    currentValue: unknown;
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
    async runInTransaction(fn) {
      return db.transaction(async (tx) => fn(tx));
    },

    async appendTransitions({ tx, kind, entityId, transitions }) {
      if (transitions.length === 0) return;
      await tx.insert(entityTransitions).values(
        transitions.map((t) => ({
          kind,
          entityId,
          field: t.field,
          fromValue: t.fromValue,
          toValue: t.toValue,
        })),
      );
    },

    async inStateSince({ kind, entityId, field, currentValue }) {
      const value = serializeFieldValue(currentValue);
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
