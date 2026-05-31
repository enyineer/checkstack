import { createHook } from "@checkstack/backend-api";
import type { EntityChanged } from "@checkstack/automation-common";

/**
 * INTERNAL entity-change hook (reactive automation engine §6.1).
 *
 * Created and emitted ONLY inside automation-backend; it is deliberately
 * NOT re-exported from the package's public surface so the only typed path
 * that emits an entity-change event is `defineEntity`. Off-pattern entity
 * state is non-reactive by construction — Stage-1 routing and scope
 * projection only ever read the framework store / this hook.
 *
 * Payload is the `EntityChangedSchema` shape (zod source of truth lives in
 * `@checkstack/automation-common`). Emitted in `mode: "work-queue"` for
 * Stage-1 routing in a later phase; this phase only emits it.
 */
export const ENTITY_CHANGED_HOOK = createHook<EntityChanged>(
  "automation.entity.changed",
);
