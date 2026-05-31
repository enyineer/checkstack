/**
 * In-memory `EntityStore` for unit tests — models the generic keyed store
 * + transition log faithfully (no real DB). Mirrors the in-memory store
 * fakes used by the dispatch tests (`test-fixtures.ts`).
 */
import type { EntityStore, TransitionAppend } from "./entity-store";
import { serializeFieldValue } from "./entity-store";

interface TransitionRow {
  kind: string;
  entityId: string;
  field: string;
  fromValue: string | null;
  toValue: string;
  transitionedAt: Date;
}

export interface FakeEntityStore extends EntityStore {
  /** Direct access to the persisted state rows (kind:id -> state). */
  readonly rows: Map<string, Record<string, unknown>>;
  /** Direct access to the transition log. */
  readonly transitions: TransitionRow[];
  /** Override the clock used for transition timestamps (defaults to Date.now). */
  setClock(fn: () => Date): void;
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

    async load({ kind, entityId }) {
      return rows.get(key(kind, entityId));
    },

    async loadMany({ kind, entityIds }) {
      const out: Record<string, Record<string, unknown>> = {};
      for (const id of entityIds) {
        const row = rows.get(key(kind, id));
        if (row) out[id] = row;
      }
      return out;
    },

    async upsert({ kind, entityId, state, transitions: appends }) {
      rows.set(key(kind, entityId), state);
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

    async remove({ kind, entityId }) {
      rows.delete(key(kind, entityId));
    },

    async inStateSince({ kind, entityId, field }) {
      const current = rows.get(key(kind, entityId));
      if (!current) return null;
      const value = serializeFieldValue(current[field]);
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
  };
}
