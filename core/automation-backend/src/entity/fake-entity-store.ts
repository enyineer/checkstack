/**
 * In-memory test doubles for the Model B entity machine.
 *
 * `createFakeEntityStore()` returns a combined fake that plays two roles a
 * unit test needs:
 *
 *   - the framework TRANSITION store (`EntityStore`): a fake transaction +
 *     an in-memory transition log + the `inStateSince` / `transitionCount`
 *     reads. The fake `runInTransaction` just runs the callback (no real tx);
 *     `tx` is a sentinel `appendTransitions` recognizes.
 *   - a plugin `read` accessor over `rows` (`readFor`), so a test can drive a
 *     kind end-to-end via `handle.mutate` and keep `rows` inspectable.
 *
 * For PLUGIN-BACKED kinds a test supplies its OWN `read` + `apply` (e.g. an
 * in-memory domain map) and only uses this fake for the transition store; see
 * `mutate-handle.test.ts`.
 */
import type { EntityStore, EntityTx, TransitionAppend } from "./entity-store";
import { serializeFieldValue } from "./entity-store";

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
  /**
   * Register an observer invoked each time `runInTransaction` opens the fake
   * framework transaction. Lets a test assert the cross-plugin ordering: the
   * plugin-backed path opens the framework (transition-append) tx ONLY after
   * the plugin write has committed.
   */
  onTransaction(fn: () => void): void;
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
  let onTx: (() => void) | undefined;

  return {
    rows,
    transitions,
    setClock(fn) {
      clock = fn;
    },
    onTransaction(fn) {
      onTx = fn;
    },

    async runInTransaction(fn) {
      // No real transaction in the fake — just run with the sentinel tx.
      onTx?.();
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
