import { createExtensionPoint } from "@checkstack/backend-api";

import type { DeclareNonReactiveState, DefineEntity } from "./define-entity";

/**
 * The `automation.entity` extension point — the single typed path to
 * reactive entity state (reactive automation engine §4.2). automation-
 * backend owns the entity store, scope projection, and wake-index, so it
 * registers this impl in Phase 1 (`register`); other plugins resolve it via
 * `env.getExtensionPoint(entityExtensionPoint)` and call `defineEntity` in
 * their own `register`/`init`. Cross-plugin calls are Proxy-buffered until
 * automation-backend registers the impl.
 *
 * - `defineEntity` — declare an entity kind + get its typed mutation handle.
 * - `declareNonReactiveState` — annotate intentionally non-reactive data
 *   (§5, §15.6) so enforcement can be strict on everything unmarked.
 */
export interface EntityExtensionPoint {
  defineEntity: DefineEntity;
  declareNonReactiveState: DeclareNonReactiveState;
}

export const entityExtensionPoint = createExtensionPoint<EntityExtensionPoint>(
  "automation.entity",
);
