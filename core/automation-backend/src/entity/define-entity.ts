import type { z } from "zod";
import type { Actor } from "@checkstack/common";

/**
 * Plugin-owned read accessor (Model B). A kind declares where its CURRENT
 * state lives by supplying a batched reader: given a set of ids, return the
 * current state for each (missing ids omitted). The state may come from the
 * plugin's own table, an in-memory map, a computed value, or the framework
 * keyed store (see {@link createKeyedStore}). `defineEntity` NEVER stores a
 * copy of its own — it only makes the plugin's state reactive.
 *
 * This is the single source of truth for `get` / `getMany`, scope
 * enrichment, the reactive `wait_until` wake re-eval, and the prev-snapshot
 * taken by `handle.mutate` before each write.
 */
export type EntityRead<TState extends Record<string, unknown>> = (
  ids: ReadonlyArray<string>,
) => Promise<Record<string, TState>>;

export interface DefineEntityInput<TState extends Record<string, unknown>> {
  /** Globally-unique entity kind (e.g. "incident", "maintenance", "health"). */
  kind: string;
  /**
   * zod = single source of truth: typing, validation, scope projection,
   * UI/editor introspection, change-event shape. MUST be a z.object.
   */
  state: z.ZodObject<z.ZodRawShape> & z.ZodType<TState>;
  /**
   * Plugin-owned current-state accessor (Model B). REQUIRED: `defineEntity`
   * owns NO current-state storage; this reader is the only path to current
   * state and the prev-snapshot for diffs. A kind with no natural home for
   * its state can opt into the framework keyed store
   * ({@link createKeyedStore}) and pass its `readMany` here.
   */
  read: EntityRead<TState>;
}

/** Mutation context so change events carry the causing actor (§3.1). */
export interface EntityMutationOpts {
  /** Defaults to the system actor when omitted. */
  actor?: Actor;
  /** Run id, when the mutation originates inside a dispatch run (masking). */
  runId?: string;
}

/**
 * The single driven mutation entry point (Model B). The handle:
 *
 *   1. snapshots `prev` via the kind's `read` accessor BEFORE the write
 *      (so a change is structurally impossible to miss),
 *   2. runs `apply()` — the plugin's ACTUAL write against ITS OWN storage,
 *      committed in the PLUGIN's own transaction. `apply` returns the
 *      resulting current state (`next`),
 *   3. AFTER the plugin write has committed, diffs prev → next and, on a real
 *      diff, appends the field-level transition rows to `entity_transitions`
 *      in the FRAMEWORK's own transaction (a separate db/client),
 *   4. emits `ENTITY_CHANGED` AFTER the plugin write has committed (never on a
 *      rolled-back / throwing write).
 *
 * Cross-plugin transaction boundary (the deliberate Model B tradeoff): a
 * plugin-backed kind keeps its state in its OWN schema, behind its OWN drizzle
 * client — a DIFFERENT client than automation-backend's `entity_transitions`.
 * Two different clients cannot share one transaction, so `apply` does NOT
 * receive the framework tx; it owns its own. The framework appends the
 * transition log in a SEPARATE transaction AFTER the plugin write commits.
 *
 * Consequences, by design:
 *   - The plugin write is the source of truth. If it throws, NOTHING is
 *     appended and NOTHING is emitted (the change never happened).
 *   - `prev` is snapshotted BEFORE `apply`, so the diff is always correct even
 *     when `read` and `apply` touch the same rows.
 *   - The transition-log append is best-effort-after-commit: if the framework
 *     append throws after a committed plugin write, the plugin state is still
 *     correct but that one transition row is missing (a history gap, never a
 *     state corruption). This is the accepted cost of decoupling plugin writes
 *     from framework-internal tables — a plugin platform must NOT couple a
 *     plugin's storage to a framework table's transaction.
 *
 * The framework keyed store ({@link createKeyedStore}) is a homeless kind's
 * opt-in storage: its `write` / `remove` run on the framework tx INSIDE the
 * plugin's own `apply`, so a keyed write still rides this same driven
 * pipeline (the keyed write and the transition append commit together).
 */
export interface MutateInput<TState extends Record<string, unknown>> {
  id: string;
  opts?: EntityMutationOpts;
  /**
   * The plugin's write, committed in the PLUGIN's own transaction. Takes no
   * arguments: the plugin owns its db/tx and must NOT receive the framework
   * tx (different client). MUST return the resulting current state (`next`)
   * so the handle can diff without a second read.
   */
  apply: () => Promise<TState>;
}

/**
 * Driven tombstone entry point. Same orchestration as {@link MutateInput},
 * but `next` is `null` (the entity is removed). `apply` performs the plugin's
 * delete in the plugin's own transaction; the handle records the tombstone
 * transition (framework tx) and emits the tombstone change AFTER the delete
 * has committed.
 */
export interface RemoveInput {
  id: string;
  opts?: EntityMutationOpts;
  /** The plugin's delete, committed in the plugin's own transaction. */
  apply: () => Promise<void>;
}

export interface EntityHandle<TState extends Record<string, unknown>> {
  readonly kind: string;
  /**
   * The single driven mutation entry point (Model B). Snapshots prev via
   * `read`, runs `apply()` (the plugin's own write, committed in the plugin's
   * own tx), then appends transitions in the framework's own tx and emits
   * `ENTITY_CHANGED` — both AFTER the plugin write commits. No-op (no emit,
   * no transition) when `apply` returns a structurally-equal state. Returns
   * the resulting state.
   */
  mutate(input: MutateInput<TState>): Promise<TState>;
  /**
   * Driven tombstone (Model B). Snapshots prev via `read`, runs `apply()`
   * (the plugin delete, committed in the plugin's own tx), records the
   * tombstone transition (framework tx), emits a tombstone `ENTITY_CHANGED`
   * (next = null) after the delete commits. No-op when the entity was already
   * absent.
   */
  remove(input: RemoveInput): Promise<void>;
  /** Current state by id (routes to `read`). */
  get(id: string): Promise<TState | undefined>;
  /** Batched current-state read (routes to `read`). Missing ids omitted. */
  getMany(ids: ReadonlyArray<string>): Promise<Record<string, TState>>;
  /** Transition helpers — generalize Phase 13's health transitions to any entity. */
  inStateSince(id: string, field: keyof TState & string): Promise<Date | null>;
  inStateForMs(id: string, field: keyof TState & string): Promise<number>;
  transitionCount(args: {
    id: string;
    field: keyof TState & string;
    windowMs: number;
  }): Promise<number>;
}

export type DefineEntity = <TState extends Record<string, unknown>>(
  input: DefineEntityInput<TState>,
) => EntityHandle<TState>;

/**
 * Escape-hatch declaration — data that looks like state but is
 * intentionally NOT a reactive entity (reactive automation engine §5,
 * §15.6). Recorded in a registry; the lint rule (a later phase) consumes
 * these declarations to suppress false positives on declared-non-reactive
 * tables.
 */
export interface DeclareNonReactiveStateInput {
  /** Drizzle table object name or table name the data lives in. */
  table: string;
  /** One of the §5 classes — forces the author to pick a reason. */
  reason: "raw-sample" | "sensitive" | "externally-owned" | "bookkeeping";
  /** Free-text justification surfaced in the lint message + docs. */
  note: string;
}

export type DeclareNonReactiveState = (
  input: DeclareNonReactiveStateInput,
) => void;
