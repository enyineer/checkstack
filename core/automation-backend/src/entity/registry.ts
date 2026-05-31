/**
 * The entity registry — the runtime behind the `automation.entity`
 * extension point. It produces `defineEntity` (and its sibling
 * `declareNonReactiveState`), enforces the load-time validation rules
 * (§6.3), tracks declarable expression indexes for init-time creation, and
 * records escape-hatch declarations for the (later-phase) lint rule.
 *
 * Model B: `defineEntity` owns no current-state storage. A kind declares a
 * plugin `read` accessor; a kind WITHOUT one is auto-wired to a framework
 * keyed store ({@link createKeyedStore}) over `entity_state` and gets the
 * deprecated `set` / `patch` / `remove(id)` sugar (back-compat for the
 * not-yet-migrated domains).
 *
 * One registry instance per automation-backend process. `defineEntity` is
 * callable from another plugin's `register`/`init` (Proxy-buffered until the
 * impl registers), so the registry tolerates being driven before the DB is
 * resolved: handles capture a lazily-set transition store + keyed-store
 * factory via an indirection, and change events buffer via the emitter (see
 * `change-emitter.ts`). The store/db are bound once at init.
 */
import { z } from "zod";

import type {
  DeclareNonReactiveStateInput,
  DefineEntity,
  DefineEntityInput,
  EntityHandle,
  EntityIndexSpec,
  EntityRead,
} from "./define-entity";
import type { EntityStore } from "./entity-store";
import { createEntityHandle } from "./create-handle";
import { type KeyedStore } from "./create-keyed-store";
import type { ChangeEmitter } from "./change-emitter";
import { buildAllIndexDdl } from "./index-ddl";
import type { RunSecretRegistry } from "../dispatch/run-secret-registry";

/** A registered escape-hatch declaration (for the lint rule, later phase). */
export type NonReactiveDeclaration = DeclareNonReactiveStateInput;

/** A batched per-kind read resolver: `getMany(ids)` for one kind. */
export type EntityKindResolver = (
  ids: ReadonlyArray<string>,
) => Promise<Record<string, Record<string, unknown>>>;

/**
 * Builds a framework keyed store for one kind. Production wraps
 * `createKeyedStore({ kind, db })`; tests pass an in-memory factory. This
 * keeps the registry independent of the concrete (drizzle) DB.
 */
export type KeyedStoreFactory = <TState extends Record<string, unknown>>(
  kind: string,
) => KeyedStore<TState>;

export interface EntityRegistry {
  /** The `defineEntity` impl exposed on the extension point. */
  readonly defineEntity: DefineEntity;
  /** The `declareNonReactiveState` impl exposed on the extension point. */
  declareNonReactiveState(input: DeclareNonReactiveStateInput): void;

  /**
   * Bind the DB-backed transition store + the keyed-store factory once init
   * has resolved the database. Both are needed: the transition store owns the
   * tx + transition log (every kind); the keyed-store factory backs
   * auto-wired store-backed kinds.
   */
  setStore(args: {
    store: EntityStore;
    keyedStoreFactory: KeyedStoreFactory;
  }): void;
  /** Whether a store has been bound yet. */
  readonly hasStore: boolean;

  /** Every declared expression-index DDL statement (for init-time creation). */
  getIndexDdl(): ReadonlyArray<string>;
  /** Every recorded escape-hatch declaration (for the lint rule). */
  getNonReactiveDeclarations(): ReadonlyArray<NonReactiveDeclaration>;
  /** Registered entity kinds, in registration order. */
  getKinds(): ReadonlyArray<string>;
  /**
   * The kind-agnostic read resolver behind the reactive `wait_until` wake
   * re-eval + scope enrichment (reactive automation engine §3.6, §8): routes
   * each kind to its `read` accessor (plugin-backed kinds via their own
   * `read`; store-backed kinds via the auto-wired keyed store). Returns
   * `undefined` for an unknown kind (enrichment leaves it unresolved,
   * fail-open).
   */
  entityResolverFor(kind: string): EntityKindResolver | undefined;
}

/** Hard-fail validation for a malformed registration (§6.3). */
function validateInput<TState extends Record<string, unknown>>(args: {
  input: DefineEntityInput<TState>;
  registeredKinds: ReadonlySet<string>;
}): void {
  const { input, registeredKinds } = args;
  const { kind, state, indexes, read } = input;

  if (typeof kind !== "string" || kind.trim().length === 0) {
    throw new Error("defineEntity: `kind` must be a non-empty string");
  }
  if (registeredKinds.has(kind)) {
    throw new Error(
      `defineEntity: duplicate kind "${kind}" — entity kinds must be globally unique`,
    );
  }
  if (read !== undefined && typeof read !== "function") {
    throw new Error(
      `defineEntity: kind "${kind}" — \`read\` must be a function`,
    );
  }
  // A plugin-backed kind (explicit `read`) keeps its state in its own table,
  // so an `entity_state` expression index over it would index nothing —
  // reject the combination loudly rather than silently ignoring the indexes.
  if (read !== undefined && indexes && indexes.length > 0) {
    throw new Error(
      `defineEntity: kind "${kind}" declares \`indexes\` with a plugin \`read\` — ` +
        `expression indexes only apply to store-backed kinds (plugin-backed state lives in your own table)`,
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

  const stateFields = new Set<string>(Object.keys(state.shape));
  // Every declared index field must be a real top-level state field — this
  // is also the SQL-injection guard for the generated expression indexes.
  for (const spec of indexes ?? []) {
    for (const field of spec.fields) {
      if (!stateFields.has(field)) {
        throw new Error(
          `defineEntity: kind "${kind}" index "${spec.name}" references unknown state field "${field}"`,
        );
      }
    }
  }
}

export function createEntityRegistry(args: {
  secretRegistry: RunSecretRegistry;
  emitter: ChangeEmitter;
}): EntityRegistry {
  const { secretRegistry, emitter } = args;

  const registeredKinds = new Set<string>();
  const kindsInOrder: string[] = [];
  const indexDdl: string[] = [];
  const nonReactive: NonReactiveDeclaration[] = [];
  // Per-kind read accessor — every kind has one (plugin-supplied, or the
  // auto-wired keyed store's `readMany`). Backs `entityResolverFor`.
  const reads = new Map<string, EntityKindResolver>();
  // Store-backed kinds need the keyed-store DB bound before they resolve;
  // `entityResolverFor` returns undefined for them until `setStore` runs
  // (fail-open in scope enrichment, and matches the pre-bind contract).
  const storeBackedKinds = new Set<string>();

  // The transition store + keyed-store factory are bound lazily at init.
  // Handles created during `register` capture this mutable indirection so a
  // mutation issued before init throws a clear error rather than a cryptic
  // "undefined.runInTransaction" (mutations realistically only happen from
  // `init` onward, by which point the store is bound).
  let store: EntityStore | undefined;
  let keyedStoreFactory: KeyedStoreFactory | undefined;

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

  /**
   * A keyed store whose reads/writes route through the lazily-bound factory.
   * Built eagerly (during `register`) for store-backed kinds so the handle
   * has a stable reference; the factory indirection throws clearly if a
   * mutation runs before init.
   */
  function lazyKeyedStore<TState extends Record<string, unknown>>(
    kind: string,
  ): KeyedStore<TState> {
    const bound = (): KeyedStore<TState> => {
      if (!keyedStoreFactory) {
        throw new Error(
          "entity store not initialized yet — defineEntity handles can only mutate from init() onward",
        );
      }
      return keyedStoreFactory<TState>(kind);
    };
    return {
      kind,
      read: (id) => bound().read(id),
      readMany: (ids) => bound().readMany(ids),
      write: (a) => bound().write(a),
      remove: (a) => bound().remove(a),
    };
  }

  const defineEntity: DefineEntity = <
    TState extends Record<string, unknown>,
  >(
    input: DefineEntityInput<TState>,
  ): EntityHandle<TState> => {
    validateInput({ input, registeredKinds });

    registeredKinds.add(input.kind);
    kindsInOrder.push(input.kind);

    // Store-backed (no plugin `read`): auto-wire a framework keyed store over
    // `entity_state`, collect its expression-index DDL, and route reads
    // through it. Plugin-backed (explicit `read`): use the plugin accessor;
    // no `entity_state` row, no index DDL (validated above).
    let read: EntityRead<TState>;
    let keyedStore: KeyedStore<TState> | undefined;
    if (input.read) {
      read = input.read;
    } else {
      keyedStore = lazyKeyedStore<TState>(input.kind);
      read = keyedStore.readMany;
      storeBackedKinds.add(input.kind);
      if (input.indexes && input.indexes.length > 0) {
        indexDdl.push(
          ...buildAllIndexDdl<TState>({
            kind: input.kind,
            indexes: input.indexes as ReadonlyArray<EntityIndexSpec<TState>>,
          }),
        );
      }
    }

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
      keyedStore,
    });
  };

  return {
    defineEntity,

    declareNonReactiveState(input) {
      nonReactive.push({ ...input });
    },

    setStore({ store: nextStore, keyedStoreFactory: factory }) {
      store = nextStore;
      keyedStoreFactory = factory;
    },
    get hasStore() {
      return store !== undefined;
    },

    getIndexDdl() {
      return indexDdl;
    },
    getNonReactiveDeclarations() {
      return nonReactive;
    },
    getKinds() {
      return kindsInOrder;
    },

    entityResolverFor(kind) {
      // Store-backed kinds resolve through the keyed store, which needs the
      // factory bound first — before that, report "unknown" so scope
      // enrichment fail-opens (and the pre-bind contract holds).
      const pendingStoreBind = storeBackedKinds.has(kind) && !keyedStoreFactory;
      // Plugin-backed kinds resolve through their own `read` immediately.
      return pendingStoreBind ? undefined : reads.get(kind);
    },
  };
}
