/**
 * Framework transition store — the kind-agnostic, plugin-storage-agnostic
 * persistence layer behind every `defineEntity` handle (Model B, reactive
 * automation engine §15.1 reshaped).
 *
 * In Model B `defineEntity` owns NO current-state storage of its own. The
 * plugin owns its state and reads it through a `read` accessor; this store
 * owns only two universal concerns:
 *
 *   1. The framework TRANSACTION used to append the `entity_transitions`
 *      rows. This wraps ONLY the post-commit transition append — the plugin's
 *      `apply` write is NOT driven inside it. The plugin's reactive-state
 *      write is a different schema behind a different drizzle client, so it
 *      cannot share this transaction; the handle runs `apply` FIRST (it
 *      commits in the plugin's own tx), then opens this framework tx solely to
 *      append the transition rows. The plugin write and the transition append
 *      therefore do NOT commit atomically together — a deliberate cross-plugin
 *      non-atomic boundary: the plugin write is authoritative, and a failure
 *      between the two leaves correct plugin state with at most a missing
 *      history row (a gap, never a corruption). Full rationale in
 *      `define-entity.ts` (the "Cross-plugin transaction boundary" note).
 *   2. The transition-LOG read helpers (`inStateSince` / `transitionCount`)
 *      that power `inStateSince` / `inStateForMs` / `transitionCount`.
 *
 * Every kind owns its current-state storage and exposes it through a `read`
 * accessor; this store touches only `entity_transitions`.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";

import { entityTransitions } from "../schema";

type Schema = {
  entityTransitions: typeof entityTransitions;
};

/**
 * The transaction handle the store opens for the framework's transition
 * append. It is the drizzle transaction object for the automation-backend
 * schema, used ONLY to append `entity_transitions` rows after the plugin's
 * `apply` has already committed (Model B). It is NOT passed to the plugin's
 * `apply`; the plugin write runs in its own client/tx and does not share this
 * one.
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
   * Run `fn` inside ONE framework database transaction, passing it the
   * transaction handle. The handle uses this ONLY to append the
   * `entity_transitions` rows AFTER the plugin's `apply` has already committed
   * (in the plugin's own tx). The plugin write is NOT driven inside this
   * transaction — it cannot be, since it lives behind a different client (the
   * non-atomic cross-plugin boundary; see the file docblock and
   * `define-entity.ts`). The post-commit change emit is done by the handle
   * AFTER this resolves.
   */
  runInTransaction<R>(fn: (tx: EntityTx) => Promise<R>): Promise<R>;

  /**
   * Append transition rows on the framework transaction opened by
   * `runInTransaction`. This is a post-commit framework write: the plugin's
   * reactive-state write has ALREADY committed separately, so these rows do
   * NOT commit atomically with it (the deliberate non-atomic boundary above).
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
