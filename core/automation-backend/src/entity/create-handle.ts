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
 *   3. AFTER the plugin write has committed: validate `next` (zod) and diff
 *      prev → next. On a real diff, append the field-level transition rows to
 *      `entity_transitions` in the FRAMEWORK's OWN transaction (a separate
 *      db/client from the plugin's write).
 *   4. Emit the internal `ENTITY_CHANGED` event carrying the mutating actor.
 *      A rolled-back / throwing `apply` emits nothing and logs nothing — the
 *      plugin write is the source of truth.
 *
 * Masking boundary: run-originated secret masking is confined to the EMITTED
 * `ENTITY_CHANGED` payload and the `entity_transitions` rows. `mutate` returns
 * the UNMASKED, zod-validated resulting state — the contract is "returns the
 * resulting state", and masking is an emission/persistence concern, not part
 * of the value the calling plugin gets back.
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

  /**
   * Validate (zod) the post-write state WITHOUT masking. This is the state
   * `mutate` returns to its caller — the contract is "returns the resulting
   * state", and masking is purely an emission/persistence concern (it must
   * not leak into the value the calling plugin gets back). A tombstone has no
   * state.
   */
  function validateNext(applied: TState | null): Record<string, unknown> | null {
    return applied === null
      ? null
      : (schema.parse(applied) as Record<string, unknown>);
  }

  /**
   * Mask an already-validated state for the run-originated emit/transition
   * path ONLY (a tombstone has none). Keeps secret VALUES out of the emitted
   * `ENTITY_CHANGED` payload and the `entity_transitions` rows, while the
   * unmasked validated state is what `mutate` returns.
   */
  function maskNext(
    validated: Record<string, unknown> | null,
    opts?: EntityMutationOpts,
  ): Record<string, unknown> | null {
    return validated === null
      ? null
      : maskForRun({
          registry: secretRegistry,
          runId: opts?.runId,
          value: validated,
        });
  }

  /**
   * Diff prev → next, append transitions, and emit `ENTITY_CHANGED` when
   * there is a real change. `appendTransitions` performs the durable
   * transition write for a non-tombstone diff in a fresh framework tx AFTER
   * the plugin write has committed.
   *
   * Masking boundary (reactive automation engine §3.5, §12): `prev` and
   * `maskedNext` are the run-masked views — they feed the diff, the
   * `entity_transitions` rows, and the emitted payload, so secret VALUES never
   * leak into history or change events. `returnNext` is the UNMASKED, validated
   * state echoed back to `mutate` (the caller gets the real resulting state;
   * masking is purely an emission/persistence concern).
   */
  async function diffAppendEmit(args2: {
    id: string;
    opts?: EntityMutationOpts;
    prev: Record<string, unknown> | null;
    maskedNext: Record<string, unknown> | null;
    returnNext: Record<string, unknown> | null;
    appendTransitions: (rows: TransitionAppend[]) => Promise<void>;
  }): Promise<Record<string, unknown> | null> {
    const { id, opts, prev, maskedNext, returnNext, appendTransitions } = args2;

    const { changedFields, delta } = diffEntityState({ prev, next: maskedNext });

    // Structurally unchanged ⇒ no transition, no emit (the write itself may
    // still have touched non-state columns; that is the plugin's concern).
    if (changedFields.length === 0) return returnNext;

    // Append transitions for a real write (a tombstone records none, like the
    // old `remove`). Built from the MASKED next so secret values stay out of
    // the durable history.
    if (maskedNext !== null) {
      await appendTransitions(
        buildTransitions({ prev, next: maskedNext, changedFields }),
      );
    }

    // Tombstone wire shape (§13.2): `delta` is `{}` because the tombstone
    // signal is `next === null`, not a per-field null delta. A real write
    // carries the changed-field delta. `changedFields` is still the set of
    // prev fields (drives the change-event `changedFields` list).
    await emitter.emit({
      kind,
      id,
      prev,
      next: maskedNext,
      delta: maskedNext === null ? {} : delta,
      changedFields,
      actor: resolveActor(opts),
      occurredAt: new Date().toISOString(),
      // Per-change identity, generated ONCE here so it travels with every
      // at-least-once redelivery of THIS change. Two distinct changes within
      // one millisecond share an `occurredAt`; the changeId keeps them
      // distinct in the Stage-2 trigger jobId (§13.2).
      changeId: crypto.randomUUID(),
    });

    return returnNext;
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

    // 1. Snapshot prev STRICTLY BEFORE the plugin write (masked view, for the
    //    diff / transitions / emit).
    const prev = await snapshotPrev(id, opts);

    // 2. Run the plugin write, committed in the PLUGIN's own tx. A throw
    //    propagates here, so nothing below runs (no append, no emit). Validate
    //    once; `returnNext` is the UNMASKED state echoed to the caller and
    //    `maskedNext` is the run-masked view used only for emit/transitions.
    const returnNext = validateNext(await apply());
    const maskedNext = maskNext(returnNext, opts);

    // 3 + 4. AFTER the plugin commit, append transitions in the FRAMEWORK's
    //    own tx, then emit. Not atomic with the plugin write (documented
    //    cross-plugin tx boundary): a failure here leaves correct plugin state
    //    with a missing history row, never a corrupted state.
    return diffAppendEmit({
      id,
      opts,
      prev,
      maskedNext,
      returnNext,
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
