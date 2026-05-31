/**
 * In-memory test doubles for the Model B entity machine.
 *
 * `createFakeEntityStore()` returns a combined fake that plays three roles a
 * unit test needs:
 *
 *   - the framework TRANSITION store (`EntityStore`): a fake transaction +
 *     an in-memory transition log + the `inStateSince` / `transitionCount`
 *     reads. The fake `runInTransaction` just runs the callback (no real tx);
 *     `tx` is a sentinel the in-memory keyed store recognizes.
 *   - an in-memory KEYED store (`KeyedStore`) over the same `rows` map, so
 *     the deprecated `set` / `patch` / `remove(id)` back-compat sugar works
 *     and `rows` stays inspectable.
 *   - a plugin `read` accessor over `rows`, so a store-backed handle reads
 *     the same state the keyed store writes.
 *
 * For PLUGIN-BACKED kinds a test supplies its OWN `read` + `apply` (e.g. an
 * in-memory domain map) and only uses this fake for the transition store; see
 * `create-handle.test.ts`.
 */
import type { EntityStore, EntityTx, TransitionAppend } from "./entity-store";
import { serializeFieldValue } from "./entity-store";
import type { KeyedStore } from "./create-keyed-store";

interface TransitionRow {
  kind: string;
  entityId: string;
  field: string;
  fromValue: string | null;
  toValue: string;
  transitionedAt: Date;
}

/** A sentinel "transaction" the fake passes to `apply` / `appendTransitions`. */
export const FAKE_TX: EntityTx = {} as unknown as EntityTx;

export interface FakeEntityStore extends EntityStore {
  /** Direct access to the persisted state rows (kind:id -> state). */
  readonly rows: Map<string, Record<string, unknown>>;
  /** Direct access to the transition log. */
  readonly transitions: TransitionRow[];
  /** Override the clock used for transition timestamps (defaults to Date.now). */
  setClock(fn: () => Date): void;
  /** An in-memory keyed store over `rows` for a given kind. */
  keyedStore<TState extends Record<string, unknown>>(
    kind: string,
  ): KeyedStore<TState>;
  /** A plugin `read` accessor over `rows` for a given kind. */
  readFor<TState extends Record<string, unknown>>(
    kind: string,
  ): (ids: ReadonlyArray<string>) => Promise<Record<string, TState>>;
}

const key = (kind: string, id: string) => `${kind}:${id}`;
const defaultClock = (): Date => new Date();

export function createFakeEntityStore(): FakeEntityStore {
  const rows = new Map<string, Record<string, unknown>>();
  const transitions: TransitionRow[] = [];
  let clock: () => Date = defaultClock;

  return {
    rows,
    transitions,
    setClock(fn) {
      clock = fn;
    },

    async runInTransaction(fn) {
      // No real transaction in the fake — just run with the sentinel tx.
      return fn(FAKE_TX);
    },

    async appendTransitions({ kind, entityId, transitions: appends }) {
      const at = clock();
      for (const t of appends as ReadonlyArray<TransitionAppend>) {
        transitions.push({
          kind,
          entityId,
          field: t.field,
          fromValue: t.fromValue,
          toValue: t.toValue,
          transitionedAt: at,
        });
      }
    },

    async inStateSince({ kind, entityId, field, currentValue }) {
      const value = serializeFieldValue(currentValue);
      const matching = transitions
        .filter(
          (t) =>
            t.kind === kind &&
            t.entityId === entityId &&
            t.field === field &&
            t.toValue === value,
        )
        .toSorted(
          (a, b) => b.transitionedAt.getTime() - a.transitionedAt.getTime(),
        );
      return matching[0]?.transitionedAt ?? null;
    },

    async transitionCount({ kind, entityId, field, windowMs, now }) {
      const since = now.getTime() - windowMs;
      return transitions.filter(
        (t) =>
          t.kind === kind &&
          t.entityId === entityId &&
          t.field === field &&
          t.transitionedAt.getTime() >= since,
      ).length;
    },

    keyedStore<TState extends Record<string, unknown>>(
      kind: string,
    ): KeyedStore<TState> {
      return {
        kind,
        async read(id) {
          return rows.get(key(kind, id)) as TState | undefined;
        },
        async readMany(ids) {
          const out: Record<string, TState> = {};
          for (const id of ids) {
            const row = rows.get(key(kind, id));
            if (row) out[id] = row as TState;
          }
          return out;
        },
        async write({ id, state }) {
          rows.set(key(kind, id), state);
          return state;
        },
        async remove({ id }) {
          rows.delete(key(kind, id));
        },
      };
    },

    readFor<TState extends Record<string, unknown>>(kind: string) {
      return async (ids: ReadonlyArray<string>) => {
        const out: Record<string, TState> = {};
        for (const id of ids) {
          const row = rows.get(key(kind, id));
          if (row) out[id] = row as TState;
        }
        return out;
      };
    },
  };
}
