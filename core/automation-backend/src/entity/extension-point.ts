import { createExtensionPoint } from "@checkstack/backend-api";

import type { DeclareNonReactiveState, DefineEntity } from "./define-entity";
import type { EntityChangeDeriver } from "./change-derivers";
import type { OnEntityChanged } from "./on-entity-changed";

/**
 * Register a per-kind trigger-event deriver (reactive automation engine §7,
 * Stage-1 routing). A domain (Phase 4) maps "this entity kind changed like
 * THIS" → the qualified trigger event id(s) it should fire; Stage 1 unions
 * the results and fans out to the enabled automations referencing them.
 */
export type RegisterChangeDeriver = (input: {
  kind: string;
  derive: EntityChangeDeriver;
}) => void;

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
 * - `onEntityChanged` — subscribe to ANOTHER domain's entity changes without
 *   touching the internal `ENTITY_CHANGED` hook (§6.1 design decision).
 * - `registerChangeDeriver` — map a kind's change to the trigger event id(s)
 *   Stage-1 routing fans out (Phase 4 supplies the per-domain derivers).
 */
export interface EntityExtensionPoint {
  defineEntity: DefineEntity;
  declareNonReactiveState: DeclareNonReactiveState;
  onEntityChanged: OnEntityChanged;
  registerChangeDeriver: RegisterChangeDeriver;
}

export const entityExtensionPoint = createExtensionPoint<EntityExtensionPoint>(
  "automation.entity",
);
