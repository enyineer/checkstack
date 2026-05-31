/**
 * Helper for ENTITY-DRIVEN triggers (reactive automation engine Phase 4).
 *
 * A domain that migrated its state to a `defineEntity` no longer emits a
 * cross-plugin lifecycle hook — the entity's change event drives dispatch
 * through Stage-1 routing (the registered `registerChangeDeriver` maps a
 * change to the qualified trigger event id). The trigger is therefore fired
 * neither by a `hook` subscription nor by a `setup` listener; it is fired by
 * the deriver matching the automation definition's `trigger.event` string
 * (via `findEnabledByTriggerEvent`).
 *
 * The trigger still needs to REGISTER (for the editor's trigger catalog +
 * payload introspection), and the trigger registry requires exactly one of
 * `hook` / `setup`. This provides a no-op `setup` so an entity-driven
 * trigger registers cleanly without re-introducing a hook. The setup
 * subscribes to nothing and tears down nothing — the deriver does the work.
 */
import type { TriggerSetupFn, TriggerTeardown } from "./action-types";

/** No-op teardown — an entity-driven trigger has no listener to remove. */
const noopTeardown: TriggerTeardown = async () => {
  // Fired by the entity change deriver; nothing to tear down.
};

/**
 * The single, payload-agnostic entity-driven `setup`: subscribes to nothing
 * and returns the no-op teardown. The trigger actually fires via its
 * registered change deriver (Stage-1 routing), not this setup.
 */
async function entityDrivenSetup(): Promise<TriggerTeardown> {
  return noopTeardown;
}

/**
 * Return the entity-driven no-op `setup`, typed for the specific trigger
 * payload/config it is assigned to. `setup` is contravariant in its payload,
 * so a single shared `unknown`-typed value won't assign to a concrete
 * `TriggerDefinition<TPayload>.setup`; this factory re-types the one shared
 * implementation for each call site without per-trigger allocation churn.
 */
export function makeEntityDrivenTriggerSetup<
  TPayload,
  TConfig = void,
>(): TriggerSetupFn<TPayload, TConfig> {
  return entityDrivenSetup;
}
