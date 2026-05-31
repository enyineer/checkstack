import type { z } from "zod";
import type { Actor } from "@checkstack/common";

import type { EntityTx } from "./entity-store";

/** A declarable secondary index over fields of the entity state. */
export interface EntityIndexSpec<TState> {
  /** Stable id, namespaced under the kind. */
  name: string;
  /** State fields the index covers (dot-paths into the zod object). */
  fields: ReadonlyArray<keyof TState & string>;
}

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
   * Plugin-owned current-state accessor (Model B). When present, the kind is
   * PLUGIN-BACKED: `defineEntity` owns NO current-state storage; this reader
   * is the only path to current state and the prev-snapshot for diffs.
   *
   * When ABSENT, the kind is STORE-BACKED: `defineEntity` auto-wires a
   * framework keyed store ({@link createKeyedStore}) over `entity_state`, and
   * the deprecated `set` / `patch` sugar mutates through it. New code should
   * supply an explicit `read` (or pass a `createKeyedStore(kind).readMany`).
   */
  read?: EntityRead<TState>;
  /**
   * Declarable secondary indexes over `entity_state` (§15.1). Only meaningful
   * for STORE-BACKED kinds (their state lives in `entity_state`); declaring
   * `indexes` alongside an explicit plugin `read` is a hard error (a
   * plugin-backed kind keeps its state in its own table, so an `entity_state`
   * expression index would index nothing).
   *
   * @deprecated The store-owned `indexes`-only form is back-compat sugar; a
   * later step removes it. Plugin-backed kinds index their own table.
   */
  indexes?: ReadonlyArray<EntityIndexSpec<TState>>;
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
 *   2. opens ONE transaction and runs `apply(tx)` — the plugin's ACTUAL
 *      write against its own storage (or the framework keyed store), which
 *      returns the resulting current state (`next`),
 *   3. diffs prev → next and, on a real diff, appends the field-level
 *      transition rows to `entity_transitions` IN THE SAME transaction,
 *   4. commits, then emits `ENTITY_CHANGED` AFTER COMMIT (never on a
 *      rolled-back write).
 *
 * Because `apply`'s write and the transition append share one transaction, a
 * non-reactive write is structurally impossible and every transition is
 * durably logged regardless of where current state lives.
 */
export interface MutateInput<TState extends Record<string, unknown>> {
  id: string;
  opts?: EntityMutationOpts;
  /**
   * The plugin's write, run inside the handle-owned transaction. Receives
   * the transaction handle `tx` so the plugin's reactive-state write commits
   * atomically with the framework transition append. MUST return the
   * resulting current state (`next`) so the handle can diff without a second
   * read.
   */
  apply: (tx: EntityTx) => Promise<TState>;
}

/**
 * Driven tombstone entry point. Same orchestration as {@link MutateInput},
 * but `next` is `null` (the entity is removed). `apply` performs the
 * plugin's delete inside the transaction; the handle records the tombstone
 * transition and emits the tombstone change AFTER COMMIT.
 */
export interface RemoveInput {
  id: string;
  opts?: EntityMutationOpts;
  /** The plugin's delete, run inside the handle-owned transaction. */
  apply: (tx: EntityTx) => Promise<void>;
}

export interface EntityHandle<TState extends Record<string, unknown>> {
  readonly kind: string;
  /**
   * The single driven mutation entry point (Model B). Snapshots prev via
   * `read`, runs `apply(tx)` in one transaction, appends transitions in the
   * same transaction, emits `ENTITY_CHANGED` after commit. No-op (no emit,
   * no transition) when `apply` returns a structurally-equal state. Returns
   * the resulting state.
   */
  mutate(input: MutateInput<TState>): Promise<TState>;
  /**
   * Driven tombstone (Model B). Snapshots prev via `read`, runs `apply(tx)`
   * (the plugin delete) in one transaction, records the tombstone transition,
   * emits a tombstone `ENTITY_CHANGED` (next = null) after commit. No-op when
   * the entity was already absent.
   */
  remove(input: RemoveInput): Promise<void>;
  /**
   * @deprecated Store-owned sugar over the driven `remove`. Tombstones a
   * STORE-BACKED kind by deleting its `entity_state` row. Only available on a
   * store-backed kind (no explicit `read`). New code: call the driven
   * `remove({ id, apply })` with your own delete.
   */
  remove(id: string, opts?: EntityMutationOpts): Promise<void>;
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

  // ─── Deprecated store-owned sugar (back-compat; removed in a later step) ──

  /**
   * @deprecated Store-owned sugar over `mutate` + the framework keyed store.
   * Validate + persist `next` into `entity_state` + diff/emit. Only available
   * on a STORE-BACKED kind (no explicit `read`). New code: declare a `read`
   * and call `mutate` with your own `apply`.
   */
  set(id: string, next: TState, opts?: EntityMutationOpts): Promise<void>;
  /**
   * @deprecated Store-owned sugar over `mutate` + the framework keyed store.
   * Shallow-merge patch into `entity_state`. Only available on a STORE-BACKED
   * kind. New code: declare a `read` and call `mutate` with your own `apply`.
   */
  patch(
    id: string,
    partial: Partial<TState>,
    opts?: EntityMutationOpts,
  ): Promise<void>;
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
