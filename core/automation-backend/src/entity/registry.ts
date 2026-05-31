/**
 * The entity registry — the runtime behind the `automation.entity`
 * extension point. It produces `defineEntity` (and its sibling
 * `declareNonReactiveState`), enforces the load-time validation rules
 * (§6.3), tracks declarable expression indexes for init-time creation, and
 * records escape-hatch declarations for the (later-phase) lint rule.
 *
 * One registry instance per automation-backend process. `defineEntity` is
 * callable from another plugin's `register`/`init` (Proxy-buffered until
 * the impl registers), so the registry must tolerate being driven before
 * the DB-backed store and emitter exist: it binds handles to a lazily-set
 * store via an indirection, and buffers change events via the emitter
 * (see `change-emitter.ts`). The store itself is set once at init.
 */
import { z } from "zod";

import type {
  DeclareNonReactiveStateInput,
  DefineEntity,
  DefineEntityInput,
  EntityHandle,
  EntityIndexSpec,
} from "./define-entity";
import type { EntityStore } from "./entity-store";
import { createEntityHandle } from "./create-handle";
import type { ChangeEmitter } from "./change-emitter";
import { buildAllIndexDdl } from "./index-ddl";
import type { RunSecretRegistry } from "../dispatch/run-secret-registry";

/** A registered escape-hatch declaration (for the lint rule, later phase). */
export type NonReactiveDeclaration = DeclareNonReactiveStateInput;

export interface EntityRegistry {
  /** The `defineEntity` impl exposed on the extension point. */
  readonly defineEntity: DefineEntity;
  /** The `declareNonReactiveState` impl exposed on the extension point. */
  declareNonReactiveState(input: DeclareNonReactiveStateInput): void;

  /** Bind the DB-backed store once init has resolved the database. */
  setStore(store: EntityStore): void;
  /** Whether a store has been bound yet. */
  readonly hasStore: boolean;

  /** Every declared expression-index DDL statement (for init-time creation). */
  getIndexDdl(): ReadonlyArray<string>;
  /** Every recorded escape-hatch declaration (for the lint rule). */
  getNonReactiveDeclarations(): ReadonlyArray<NonReactiveDeclaration>;
  /** Registered entity kinds, in registration order. */
  getKinds(): ReadonlyArray<string>;
}

/** Hard-fail validation for a malformed registration (§6.3). */
function validateInput<TState extends Record<string, unknown>>(args: {
  input: DefineEntityInput<TState>;
  registeredKinds: ReadonlySet<string>;
}): void {
  const { input, registeredKinds } = args;
  const { kind, state, indexes } = input;

  if (typeof kind !== "string" || kind.trim().length === 0) {
    throw new Error("defineEntity: `kind` must be a non-empty string");
  }
  if (registeredKinds.has(kind)) {
    throw new Error(
      `defineEntity: duplicate kind "${kind}" — entity kinds must be globally unique`,
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

  // The store is bound lazily at init. Handles created during `register`
  // capture this mutable ref so a mutation issued before init throws a
  // clear error rather than a cryptic "undefined.load" (mutations realistically
  // only happen from `init` onward, by which point the store is set).
  let store: EntityStore | undefined;
  const storeProxy: EntityStore = {
    load: (a) => requireStore().load(a),
    loadMany: (a) => requireStore().loadMany(a),
    upsert: (a) => requireStore().upsert(a),
    remove: (a) => requireStore().remove(a),
    inStateSince: (a) => requireStore().inStateSince(a),
    transitionCount: (a) => requireStore().transitionCount(a),
  };
  function requireStore(): EntityStore {
    if (!store) {
      throw new Error(
        "entity store not initialized yet — defineEntity handles can only mutate from init() onward",
      );
    }
    return store;
  }

  const defineEntity: DefineEntity = <
    TState extends Record<string, unknown>,
  >(
    input: DefineEntityInput<TState>,
  ): EntityHandle<TState> => {
    validateInput({ input, registeredKinds });

    registeredKinds.add(input.kind);
    kindsInOrder.push(input.kind);

    // Collect the declarable expression-index DDL for init-time creation.
    if (input.indexes && input.indexes.length > 0) {
      indexDdl.push(
        ...buildAllIndexDdl<TState>({
          kind: input.kind,
          indexes: input.indexes as ReadonlyArray<EntityIndexSpec<TState>>,
        }),
      );
    }

    return createEntityHandle<TState>({
      kind: input.kind,
      schema: input.state,
      store: storeProxy,
      emitter,
      secretRegistry,
    });
  };

  return {
    defineEntity,

    declareNonReactiveState(input) {
      nonReactive.push({ ...input });
    },

    setStore(next) {
      store = next;
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
  };
}
