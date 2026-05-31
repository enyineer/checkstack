/**
 * `createKeyedStore(kind)` — the turnkey current-state store for HOMELESS
 * kinds (Model B, reactive automation engine §15.1 reshaped).
 *
 * In Model B `defineEntity` owns no storage; a kind supplies a `read`
 * accessor pointing at wherever its state lives. A kind that has NO natural
 * home for its current state can opt into this framework store: it is backed
 * by the generic `entity_state` table (+ the declarable expression indexes)
 * and plugs into `defineEntity` / `handle.mutate` like any other plugin
 * storage:
 *
 * ```ts
 * const store = createKeyedStore<MyState>("my-kind");
 * const handle = defineEntity({ kind: "my-kind", state, read: store.readMany });
 * // ...later, inside a mutation:
 * await handle.mutate({
 *   id,
 *   apply: (tx) => store.write({ tx, id, state: next }),
 * });
 * ```
 *
 * `read` / `readMany` read the current row(s) from `entity_state`. `write` /
 * `remove` mutate `entity_state` on the handle's transaction, so the keyed
 * write and the framework transition append commit atomically.
 *
 * Kinds that own their storage NEVER touch this — they read their own table
 * and write it in their own `apply`.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";

import { entityState } from "../schema";
import type { EntityTx } from "./entity-store";

type Schema = {
  entityState: typeof entityState;
};

/**
 * A framework keyed store bound to one kind, backed by `entity_state`.
 * `TState` is the kind's validated state shape. `read` / `readMany` are
 * `EntityRead`-compatible (they return `Record<string, TState>`); `write` /
 * `remove` are tx-aware writers for use inside `handle.mutate` / `remove`.
 */
export interface KeyedStore<TState extends Record<string, unknown>> {
  readonly kind: string;
  /** Read one id's current state, or undefined when absent. */
  read(id: string): Promise<TState | undefined>;
  /**
   * Batched read — the `EntityRead` accessor to pass to
   * `defineEntity({ read })`. Missing ids are omitted.
   */
  readMany(ids: ReadonlyArray<string>): Promise<Record<string, TState>>;
  /**
   * Upsert `state` for `id` on the handle's transaction and return it (so it
   * can be the `apply` return = `next`). Atomic with the transition append.
   */
  write(args: { tx: EntityTx; id: string; state: TState }): Promise<TState>;
  /** Delete `id`'s row on the handle's transaction (tombstone). */
  remove(args: { tx: EntityTx; id: string }): Promise<void>;
}

export function createKeyedStore<TState extends Record<string, unknown>>(args: {
  kind: string;
  db: SafeDatabase<Schema>;
}): KeyedStore<TState> {
  const { kind, db } = args;

  async function readMany(
    ids: ReadonlyArray<string>,
  ): Promise<Record<string, TState>> {
    if (ids.length === 0) return {};
    const rows = await db
      .select()
      .from(entityState)
      .where(
        and(
          eq(entityState.kind, kind),
          inArray(entityState.entityId, [...ids]),
        ),
      );
    const out: Record<string, TState> = {};
    for (const row of rows) out[row.entityId] = row.state as TState;
    return out;
  }

  return {
    kind,
    readMany,

    async read(id) {
      const [row] = await db
        .select()
        .from(entityState)
        .where(and(eq(entityState.kind, kind), eq(entityState.entityId, id)))
        .limit(1);
      return row?.state as TState | undefined;
    },

    async write({ tx, id, state }) {
      await tx
        .insert(entityState)
        .values({ kind, entityId: id, state, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [entityState.kind, entityState.entityId],
          set: { state, updatedAt: new Date() },
        });
      return state;
    },

    async remove({ tx, id }) {
      await tx
        .delete(entityState)
        .where(and(eq(entityState.kind, kind), eq(entityState.entityId, id)));
    },
  };
}
