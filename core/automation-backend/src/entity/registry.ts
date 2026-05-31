/**
 * The entity registry — the runtime behind the `automation.entity`
 * extension point. It produces `defineEntity` (and its sibling
 * `declareNonReactiveState`), enforces the load-time validation rules
 * (§6.3), tracks declarable expression indexes for init-time creation, and
 * records escape-hatch declarations for the (later-phase) lint rule.
 *
 * Model B: `defineEntity` owns no current-state storage. Every kind declares
 * a plugin `read` accessor pointing at wherever its state lives (its own
 * table, an in-memory map, or a computed value).
 *
 * One registry instance per automation-backend process. `defineEntity` is
 * callable from another plugin's `register`/`init` (Proxy-buffered until the
 * impl registers), so the registry tolerates being driven before the DB is
 * resolved: handles capture a lazily-set transition store via an indirection,
 * and change events buffer via the emitter (see `change-emitter.ts`). The
 * store/db are bound once at init.
 */
import { z } from "zod";

import type {
  DeclareNonReactiveStateInput,
  DefineEntity,
  DefineEntityInput,
  EntityHandle,
  EntityRead,
} from "./define-entity";
import type { EntityStore } from "./entity-store";
import { createEntityHandle } from "./create-handle";
import type { ChangeEmitter } from "./change-emitter";
import type { RunSecretRegistry } from "../dispatch/run-secret-registry";

/** A registered escape-hatch declaration (for the lint rule, later phase). */
export type NonReactiveDeclaration = DeclareNonReactiveStateInput;

/** A batched per-kind read resolver: `getMany(ids)` for one kind. */
export type EntityKindResolver = (
  ids: ReadonlyArray<string>,
) => Promise<Record<string, Record<string, unknown>>>;

export interface EntityRegistry {
  /** The `defineEntity` impl exposed on the extension point. */
  readonly defineEntity: DefineEntity;
  /** The `declareNonReactiveState` impl exposed on the extension point. */
  declareNonReactiveState(input: DeclareNonReactiveStateInput): void;

  /**
   * Bind the DB-backed transition store once init has resolved the database.
   * The transition store owns the tx + transition log for every kind.
   */
  setStore(args: { store: EntityStore }): void;
  /** Whether a store has been bound yet. */
  readonly hasStore: boolean;

  /** Every recorded escape-hatch declaration (for the lint rule). */
  getNonReactiveDeclarations(): ReadonlyArray<NonReactiveDeclaration>;
  /** Registered entity kinds, in registration order. */
  getKinds(): ReadonlyArray<string>;
  /**
   * The kind-agnostic read resolver behind the reactive `wait_until` wake
   * re-eval + scope enrichment (reactive automation engine §3.6, §8): routes
   * each kind to its plugin `read` accessor. Returns `undefined` for an
   * unknown kind (enrichment leaves it unresolved, fail-open).
   */
  entityResolverFor(kind: string): EntityKindResolver | undefined;
}

/** Hard-fail validation for a malformed registration (§6.3). */
function validateInput<TState extends Record<string, unknown>>(args: {
  input: DefineEntityInput<TState>;
  registeredKinds: ReadonlySet<string>;
}): void {
  const { input, registeredKinds } = args;
  const { kind, state, read } = input;

  if (typeof kind !== "string" || kind.trim().length === 0) {
    throw new Error("defineEntity: `kind` must be a non-empty string");
  }
  if (registeredKinds.has(kind)) {
    throw new Error(
      `defineEntity: duplicate kind "${kind}" — entity kinds must be globally unique`,
    );
  }
  // Model B: every kind owns its state and exposes it through a plugin `read`
  // accessor.
  if (typeof read !== "function") {
    throw new TypeError(
      `defineEntity: kind "${kind}" — \`read\` must be a function`,
    );
  }
  // The state schema MUST be a z.object: scope projection, UI introspection,
  // and per-field transitions all rely on enumerable top-level fields. The
  // static type says `state` is a ZodObject, but callers reaching us through
  // the extension point are untyped, so this guard is a real runtime check —
  // read through `unknown` since TS narrows the failing branch to `never`.
  if (!(state instanceof z.ZodObject)) {
    const received: unknown = state;
    const describe =
      received == null
        ? String(received)
        : ((received as { constructor?: { name?: string } }).constructor
            ?.name ?? typeof received);
    throw new Error(
      `defineEntity: kind "${kind}" — \`state\` must be a z.object (got ${describe})`,
    );
  }
}

export function createEntityRegistry(args: {
  secretRegistry: RunSecretRegistry;
  emitter: ChangeEmitter;
}): EntityRegistry {
  const { secretRegistry, emitter } = args;

  const registeredKinds = new Set<string>();
  const kindsInOrder: string[] = [];
  const nonReactive: NonReactiveDeclaration[] = [];
  // Per-kind plugin `read` accessor. Backs `entityResolverFor`.
  const reads = new Map<string, EntityKindResolver>();

  // The transition store is bound lazily at init. Handles created during
  // `register` capture this mutable indirection so a mutation issued before
  // init throws a clear error rather than a cryptic
  // "undefined.runInTransaction" (mutations realistically only happen from
  // `init` onward, by which point the store is bound).
  let store: EntityStore | undefined;

  function requireStore(): EntityStore {
    if (!store) {
      throw new Error(
        "entity store not initialized yet — defineEntity handles can only mutate from init() onward",
      );
    }
    return store;
  }
  const storeProxy: EntityStore = {
    runInTransaction: (fn) => requireStore().runInTransaction(fn),
    appendTransitions: (a) => requireStore().appendTransitions(a),
    inStateSince: (a) => requireStore().inStateSince(a),
    transitionCount: (a) => requireStore().transitionCount(a),
  };

  const defineEntity: DefineEntity = <
    TState extends Record<string, unknown>,
  >(
    input: DefineEntityInput<TState>,
  ): EntityHandle<TState> => {
    validateInput({ input, registeredKinds });

    registeredKinds.add(input.kind);
    kindsInOrder.push(input.kind);

    // Every kind exposes its current state through a plugin `read` accessor
    // (its own table, an in-memory map, or a computed value). `defineEntity`
    // owns no current-state storage.
    const read: EntityRead<TState> = input.read;

    // Register the read accessor so `entityResolverFor` can route scope
    // enrichment + wake re-eval to it (cast: the resolver is untyped record).
    reads.set(input.kind, (ids) =>
      read(ids) as Promise<Record<string, Record<string, unknown>>>,
    );

    return createEntityHandle<TState>({
      kind: input.kind,
      schema: input.state,
      store: storeProxy,
      emitter,
      secretRegistry,
      read,
    });
  };

  return {
    defineEntity,

    declareNonReactiveState(input) {
      nonReactive.push({ ...input });
    },

    setStore({ store: nextStore }) {
      store = nextStore;
    },
    get hasStore() {
      return store !== undefined;
    },

    getNonReactiveDeclarations() {
      return nonReactive;
    },
    getKinds() {
      return kindsInOrder;
    },

    entityResolverFor(kind) {
      // Plugin-backed kinds resolve through their own `read` immediately.
      return reads.get(kind);
    },
  };
}
