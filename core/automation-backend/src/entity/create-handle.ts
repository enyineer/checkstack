/**
 * Builds an `EntityHandle` for one validated kind. This is where the
 * §4.3 derivations live: zod-validate, mask run-originated writes, diff
 * against the prior row, no-op when unchanged, upsert + append transitions,
 * and emit the internal `ENTITY_CHANGED` event carrying the mutating actor.
 */
import type { z } from "zod";
import { SYSTEM_ACTOR, type Actor } from "@checkstack/common";

import type {
  EntityHandle,
  EntityMutationOpts,
} from "./define-entity";
import type { EntityStore, TransitionAppend } from "./entity-store";
import { serializeFieldValue } from "./entity-store";
import { diffEntityState } from "./diff";
import type { ChangeEmitter } from "./change-emitter";
import type { RunSecretRegistry } from "../dispatch/run-secret-registry";

export interface CreateHandleArgs<TState extends Record<string, unknown>> {
  kind: string;
  schema: z.ZodType<TState>;
  store: EntityStore;
  emitter: ChangeEmitter;
  secretRegistry: RunSecretRegistry;
}

/** Resolve the effective actor for a mutation (defaults to the system actor). */
function resolveActor(opts?: EntityMutationOpts): Actor {
  return opts?.actor ?? SYSTEM_ACTOR;
}

/** Apply run-scoped secret masking to a payload when the write is run-originated. */
function maskForRun(args: {
  registry: RunSecretRegistry;
  runId: string | undefined;
  value: Record<string, unknown>;
}): Record<string, unknown> {
  const { registry, runId, value } = args;
  if (!runId) return value;
  // maskDeep returns the same JSON-shape with secret VALUES redacted.
  const masked = registry.maskDeep(runId, value);
  return masked as Record<string, unknown>;
}

export function createEntityHandle<TState extends Record<string, unknown>>(
  args: CreateHandleArgs<TState>,
): EntityHandle<TState> {
  const { kind, schema, store, emitter, secretRegistry } = args;

  /**
   * Shared write path for `set` (full) and `patch` (merged). `nextState`
   * is the already-merged candidate; this validates, masks, diffs against
   * the prior row, and (only on a real diff) persists + emits.
   */
  async function write(
    id: string,
    nextState: TState,
    opts?: EntityMutationOpts,
  ): Promise<void> {
    // 1. Validate against the kind's zod object — single source of truth.
    const validated = schema.parse(nextState) as Record<string, unknown>;

    // 2. Mask secret values BEFORE anything is persisted or emitted, when
    //    the write originates inside a dispatch run (§3.5).
    const next = maskForRun({
      registry: secretRegistry,
      runId: opts?.runId,
      value: validated,
    });

    // 3. Load the prior row and diff structurally.
    const prev = (await store.load({ kind, entityId: id })) ?? null;
    const { changedFields, delta } = diffEntityState({ prev, next });

    // 4. No real change ⇒ no-op (mirrors the dwell "no change" semantics).
    if (changedFields.length === 0) return;

    // 5. Append a transition row per changed field (powers since/duration).
    const transitions: TransitionAppend[] = changedFields.map((field) => ({
      field,
      fromValue: prev ? serializeFieldValue(prev[field]) : null,
      toValue: serializeFieldValue(next[field]),
    }));

    // 6. Persist state + transitions atomically.
    await store.upsert({ kind, entityId: id, state: next, transitions });

    // 7. Emit the internal change event carrying the mutating actor.
    await emitter.emit({
      kind,
      id,
      prev,
      next,
      delta,
      changedFields,
      actor: resolveActor(opts),
      occurredAt: new Date().toISOString(),
    });
  }

  return {
    kind,

    async set(id, next, opts) {
      await write(id, next, opts);
    },

    async patch(id, partial, opts) {
      const prior = await store.load({ kind, entityId: id });
      // Shallow-merge onto the prior state (spreading `undefined` is a
      // no-op, so a first-write patch merges onto an empty base).
      const merged = { ...prior, ...partial } as TState;
      await write(id, merged, opts);
    },

    async get(id) {
      const row = await store.load({ kind, entityId: id });
      return row as TState | undefined;
    },

    async getMany(ids) {
      const rows = await store.loadMany({ kind, entityIds: ids });
      return rows as Record<string, TState>;
    },

    async remove(id, opts) {
      const prev = (await store.load({ kind, entityId: id })) ?? null;
      // Removing an absent entity is a no-op (nothing to tombstone).
      if (prev === null) return;
      await store.remove({ kind, entityId: id });
      // Tombstone change event: next + delta are null (§4.3, §13.2 — delta
      // is `{}` on the wire because EntityChangedSchema.delta is a record;
      // the tombstone signal is `next === null`).
      await emitter.emit({
        kind,
        id,
        prev,
        next: null,
        delta: {},
        changedFields: Object.keys(prev).toSorted(),
        actor: resolveActor(opts),
        occurredAt: new Date().toISOString(),
      });
    },

    async inStateSince(id, field) {
      return store.inStateSince({ kind, entityId: id, field });
    },

    async inStateForMs(id, field) {
      const since = await store.inStateSince({ kind, entityId: id, field });
      if (since === null) return 0;
      return Math.max(Date.now() - since.getTime(), 0);
    },

    async transitionCount({ id, field, windowMs }) {
      return store.transitionCount({
        kind,
        entityId: id,
        field,
        windowMs,
        now: new Date(),
      });
    },
  };
}
