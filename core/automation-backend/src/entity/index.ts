/**
 * Public surface of the entity state machine (reactive automation engine
 * §4). The internal `ENTITY_CHANGED` hook (`./hook`) is deliberately NOT
 * re-exported — `defineEntity` is the only typed path that emits an
 * entity-change event (§6.1).
 */
export { entityExtensionPoint } from "./extension-point";
export type { EntityExtensionPoint } from "./extension-point";
export type {
  DefineEntity,
  DefineEntityInput,
  DeclareNonReactiveState,
  DeclareNonReactiveStateInput,
  EntityHandle,
  EntityIndexSpec,
  EntityMutationOpts,
} from "./define-entity";

// Internal wiring surface (consumed by automation-backend's index.ts).
export { createEntityRegistry } from "./registry";
export type { EntityRegistry, NonReactiveDeclaration } from "./registry";
export { createEntityStore } from "./entity-store";
export type { EntityStore } from "./entity-store";
export { createChangeEmitter } from "./change-emitter";
export type { ChangeEmitter, EmitEntityChanged } from "./change-emitter";
