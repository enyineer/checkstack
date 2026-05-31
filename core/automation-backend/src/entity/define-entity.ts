import type { z } from "zod";
import type { Actor } from "@checkstack/common";

/** A declarable secondary index over fields of the entity state. */
export interface EntityIndexSpec<TState> {
  /** Stable id, namespaced under the kind. */
  name: string;
  /** State fields the index covers (dot-paths into the zod object). */
  fields: ReadonlyArray<keyof TState & string>;
}

export interface DefineEntityInput<TState extends Record<string, unknown>> {
  /** Globally-unique entity kind (e.g. "incident", "maintenance", "health"). */
  kind: string;
  /**
   * zod = single source of truth: typing, validation, scope projection,
   * UI/editor introspection, change-event shape. MUST be a z.object.
   */
  state: z.ZodObject<z.ZodRawShape> & z.ZodType<TState>;
  /** Declarable secondary indexes (map onto the generic store — see §15.1). */
  indexes?: ReadonlyArray<EntityIndexSpec<TState>>;
}

/** Mutation context so change events carry the causing actor (§3.1). */
export interface EntityMutationOpts {
  /** Defaults to the system actor when omitted. */
  actor?: Actor;
  /** Run id, when the mutation originates inside a dispatch run (masking). */
  runId?: string;
}

export interface EntityHandle<TState extends Record<string, unknown>> {
  readonly kind: string;
  /** Validate + persist + diff; emits change(kind:id, delta) only on a real diff. */
  set(id: string, next: TState, opts?: EntityMutationOpts): Promise<void>;
  /** Shallow-merge patch; same diff/emit/wake/transition pipeline. */
  patch(
    id: string,
    partial: Partial<TState>,
    opts?: EntityMutationOpts,
  ): Promise<void>;
  /** Current state by id (resolver — used by scope enrichment + wake re-eval). */
  get(id: string): Promise<TState | undefined>;
  /** Batched resolver for scope pre-resolution (mirrors getBulkHealthState). */
  getMany(ids: ReadonlyArray<string>): Promise<Record<string, TState>>;
  /** Remove the entity (emits a tombstone change event with delta = null). */
  remove(id: string, opts?: EntityMutationOpts): Promise<void>;
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
