/**
 * Builds an `EntityHandle` for one validated kind — the Model B reactive
 * wrapper (reactive automation engine §4, reshaped).
 *
 * `defineEntity` owns NO current-state storage. The plugin owns its state
 * and exposes it through a `read` accessor; this handle makes that state
 * REACTIVE by funneling every write through one driven entry point:
 *
 *   handle.mutate({ id, opts?, apply })
 *
 * The orchestration (`mutate` and `remove` share it):
 *
 *   1. Snapshot `prev` via `read([id])` BEFORE the write, so a change can
 *      never be missed (we never re-read prev AFTER the plugin has written).
 *   2. Run the plugin's `apply()` — the ACTUAL write against its OWN storage,
 *      committed in the PLUGIN's own transaction. `apply` returns the
 *      resulting current state (`next`); `remove`'s `apply` returns void and
 *      `next` is `null` (tombstone). `apply` takes NO tx: a plugin-backed kind
 *      lives behind a different drizzle client than `entity_transitions`, so
 *      it cannot share the framework transaction.
 *   3. AFTER the plugin write has committed: validate `next` (zod), mask
 *      run-originated writes, diff prev → next. On a real diff, append the
 *      field-level transition rows to `entity_transitions` in the FRAMEWORK's
 *      OWN transaction (a separate db/client from the plugin's write).
 *   4. Emit the internal `ENTITY_CHANGED` event carrying the mutating actor.
 *      A rolled-back / throwing `apply` emits nothing and logs nothing — the
 *      plugin write is the source of truth.
 *
 * Cross-plugin transaction boundary (the deliberate tradeoff): the plugin
 * write (step 2) and the transition append (step 3) are NOT in one shared db
 * transaction — they target different schemas behind different clients. The
 * plugin write is authoritative; the transition append is a post-commit
 * framework write. A failure between them leaves correct plugin state with a
 * missing history row (a gap, never a corruption). A plugin platform must NOT
 * couple plugin writes to framework-internal tables, so this decoupling is
 * intentional. See `define-entity.ts` for the full rationale.
 *
 * A homeless kind that opts into the framework keyed store
 * ({@link createKeyedStore}) writes `entity_state` from INSIDE its own
 * `apply` (it runs the keyed write on the framework tx supplied by the keyed
 * store's service), so it still rides this same driven pipeline.
 *
 * A structurally-unchanged write (returns an equal state) is a no-op: the
 * plugin write still happened, but no transition is appended and no event is
 * emitted.
 */
import type { z } from "zod";
import { SYSTEM_ACTOR, type Actor } from "@checkstack/common";

import type {
  EntityHandle,
  EntityMutationOpts,
  EntityRead,
  MutateInput,
  RemoveInput,
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
  /** Plugin-owned current-state accessor (the single read path). */
  read: EntityRead<TState>;
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
  const { kind, schema, store, emitter, secretRegistry, read } = args;

  /** Resolve the current state of one id via the plugin read accessor. */
  async function readOne(id: string): Promise<TState | undefined> {
    const map = await read([id]);
    return map[id];
  }

  /** Build the transition rows for a changed-field set (prev/next views). */
  function buildTransitions(args2: {
    prev: Record<string, unknown> | null;
    next: Record<string, unknown>;
    changedFields: string[];
  }): TransitionAppend[] {
    const { prev, next, changedFields } = args2;
    return changedFields.map((field) => ({
      field,
      fromValue: prev ? serializeFieldValue(prev[field]) : null,
      toValue: serializeFieldValue(next[field]),
    }));
  }

  /**
   * Snapshot `prev` via the plugin `read` accessor STRICTLY BEFORE any write,
   * masking run-originated reads. A change can never be missed because we
   * never re-read prev after the write.
   */
  async function snapshotPrev(
    id: string,
    opts?: EntityMutationOpts,
  ): Promise<Record<string, unknown> | null> {
    const prevRaw = (await readOne(id)) ?? null;
    return prevRaw === null
      ? null
      : maskForRun({
          registry: secretRegistry,
          runId: opts?.runId,
          value: prevRaw as Record<string, unknown>,
        });
  }

  /** Validate (zod) + mask the post-write state (a tombstone has none). */
  function normalizeNext(
    applied: TState | null,
    opts?: EntityMutationOpts,
  ): Record<string, unknown> | null {
    return applied === null
      ? null
      : maskForRun({
          registry: secretRegistry,
          runId: opts?.runId,
          value: schema.parse(applied) as Record<string, unknown>,
        });
  }

  /**
   * Diff prev → next and emit `ENTITY_CHANGED` when there is a real change.
   * `appendTransitions` performs the durable transition write for a
   * non-tombstone diff in a fresh framework tx AFTER the plugin write has
   * committed. Returns the post-write state (echoed for `mutate`).
   */
  async function diffAppendEmit(args2: {
    id: string;
    opts?: EntityMutationOpts;
    prev: Record<string, unknown> | null;
    next: Record<string, unknown> | null;
    appendTransitions: (rows: TransitionAppend[]) => Promise<void>;
  }): Promise<Record<string, unknown> | null> {
    const { id, opts, prev, next, appendTransitions } = args2;

    const { changedFields, delta } = diffEntityState({ prev, next });

    // Structurally unchanged ⇒ no transition, no emit (the write itself may
    // still have touched non-state columns; that is the plugin's concern).
    if (changedFields.length === 0) return next;

    // Append transitions for a real write (a tombstone records none, like the
    // old `remove`).
    if (next !== null) {
      await appendTransitions(buildTransitions({ prev, next, changedFields }));
    }

    // Tombstone wire shape (§13.2): `delta` is `{}` because the tombstone
    // signal is `next === null`, not a per-field null delta. A real write
    // carries the changed-field delta. `changedFields` is still the set of
    // prev fields (drives the change-event `changedFields` list).
    await emitter.emit({
      kind,
      id,
      prev,
      next,
      delta: next === null ? {} : delta,
      changedFields,
      actor: resolveActor(opts),
      occurredAt: new Date().toISOString(),
    });

    return next;
  }

  /**
   * PLUGIN-BACKED driven pipeline for `mutate` / `remove`. The plugin's
   * `apply()` runs FIRST and commits in the PLUGIN's own transaction (no
   * framework tx is handed in — a plugin-backed kind lives behind a different
   * client). Only AFTER that commit does the framework open its OWN
   * transaction to append the transition log, then emit. The plugin write is
   * authoritative; a throwing `apply` appends nothing and emits nothing.
   */
  async function drivePluginBacked(input: {
    id: string;
    opts?: EntityMutationOpts;
    apply: () => Promise<TState | null>;
  }): Promise<Record<string, unknown> | null> {
    const { id, opts, apply } = input;

    // 1. Snapshot prev STRICTLY BEFORE the plugin write.
    const prev = await snapshotPrev(id, opts);

    // 2. Run the plugin write, committed in the PLUGIN's own tx. A throw
    //    propagates here, so nothing below runs (no append, no emit).
    const next = normalizeNext(await apply(), opts);

    // 3 + 4. AFTER the plugin commit, append transitions in the FRAMEWORK's
    //    own tx, then emit. Not atomic with the plugin write (documented
    //    cross-plugin tx boundary): a failure here leaves correct plugin state
    //    with a missing history row, never a corrupted state.
    return diffAppendEmit({
      id,
      opts,
      prev,
      next,
      appendTransitions: (rows) =>
        store.runInTransaction((tx) =>
          store.appendTransitions({ tx, kind, entityId: id, transitions: rows }),
        ),
    });
  }

  /** Resolve "in this value since" for a field via the transition log. */
  async function inStateSinceFor(
    id: string,
    field: string,
  ): Promise<Date | null> {
    const current = await readOne(id);
    if (current === undefined) return null;
    return store.inStateSince({
      kind,
      entityId: id,
      field,
      currentValue: current[field],
    });
  }

  return {
    kind,

    async mutate(input: MutateInput<TState>): Promise<TState> {
      const { id, opts, apply } = input;
      // `apply` always returns a (non-null) state, so the pipeline resolves it
      // regardless of whether the diff was a no-op.
      const next = await drivePluginBacked({ id, opts, apply: () => apply() });
      // Unreachable: `mutate`'s apply never yields null. Guarded for types.
      if (next === null) {
        throw new Error(
          `EntityHandle.mutate: apply for kind "${kind}" id "${id}" resolved to no state`,
        );
      }
      return next as TState;
    },

    async remove(input: RemoveInput): Promise<void> {
      const { id, opts, apply } = input;
      await drivePluginBacked({
        id,
        opts,
        apply: async () => {
          await apply();
          return null;
        },
      });
    },

    async get(id) {
      return readOne(id);
    },

    async getMany(ids) {
      return read(ids);
    },

    async inStateSince(id, field) {
      return inStateSinceFor(id, field);
    },

    async inStateForMs(id, field) {
      const since = await inStateSinceFor(id, field);
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
