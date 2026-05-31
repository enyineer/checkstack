/**
 * Public surface of the entity state machine (reactive automation engine
 * §4). The internal `ENTITY_CHANGED` hook (`./hook`) is deliberately NOT
 * re-exported — `defineEntity` is the only typed path that emits an
 * entity-change event (§6.1).
 */
export { entityExtensionPoint } from "./extension-point";
export type {
  EntityExtensionPoint,
  RegisterChangeDeriver,
} from "./extension-point";
export {
  createChangeDeriverRegistry,
} from "./change-derivers";
export type {
  ChangeDeriverRegistry,
  EntityChangeDeriver,
} from "./change-derivers";
export {
  createEntityChangedSubscriptions,
} from "./on-entity-changed";
export type {
  EntityChangedSubscriptions,
  OnEntityChanged,
  OnEntityChangedInput,
  EntityChangedHandler,
  EntityChangedDelivery,
  EntityChangedUnsubscribe,
} from "./on-entity-changed";
export type {
  DefineEntity,
  DefineEntityInput,
  DeclareNonReactiveState,
  DeclareNonReactiveStateInput,
  EntityHandle,
  EntityMutationOpts,
  EntityRead,
  MutateInput,
  RemoveInput,
} from "./define-entity";

// Internal wiring surface (consumed by automation-backend's index.ts).
export { createEntityRegistry } from "./registry";
export type {
  EntityRegistry,
  NonReactiveDeclaration,
  EntityKindResolver,
} from "./registry";
export { createEntityStore } from "./entity-store";
export type { EntityStore, EntityTx } from "./entity-store";
export { createKeyedStore } from "./create-keyed-store";
export type { KeyedStore } from "./create-keyed-store";
export { createChangeEmitter } from "./change-emitter";
export type { ChangeEmitter, EmitEntityChanged } from "./change-emitter";
