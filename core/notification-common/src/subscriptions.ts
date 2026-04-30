/**
 * Cross-plugin notification-subscription pattern.
 *
 * A subscription spec describes one *kind* of notification a plugin
 * offers (e.g. anomaly's "alert me about this system"). The spec
 * references a `NotificationTarget` — a typed handle on a resource type
 * (e.g. `catalogSystemTarget`) — and supplies display metadata. The
 * platform handles everything else:
 *
 *   - notification-backend materializes one notification group per
 *     (registered spec × known resource of the spec's target type),
 *     keyed `<ownerPlugin>.<spec.localId>.<resourceKey>`.
 *   - The frontend extension factory derives the slot from
 *     `spec.target.slot` so plugin authors never re-pass it.
 *   - At dispatch time, callers supply `(specId, resourceKeys)`;
 *     notification-backend resolves group ids, walks the target's
 *     `parents` chain for inheritance, and delivers.
 *
 * Plugin-author surface area is intentionally minimal: a `target`
 * reference, a `localId`, and display metadata. No groupIdFor, no
 * resourceKind (carried by the target), no slot at the registration
 * site, no per-plugin lifecycle code.
 */

import type { NotificationTarget } from "./targets";

interface PluginMetadataLike {
  pluginId: string;
}

export interface SubscriptionDisplayMeta {
  title: string;
  description: string;
  iconName?: string;
}

/**
 * Declarative description of a subscription a plugin offers for the
 * resources of a given target. Group ids are derived from the
 * convention `<ownerPlugin>.<spec.localId>.<resourceKey>` — there is no
 * escape hatch. Plugins that need an exotic group structure should
 * register a different target type instead.
 */
export interface NotificationSubscriptionSpec<TResource> {
  /** `<ownerPlugin>.<localId>` — namespaced like the target ids. */
  readonly specId: string;
  readonly ownerPlugin: string;
  readonly localId: string;
  readonly target: NotificationTarget<TResource>;
  readonly display: SubscriptionDisplayMeta;
}

/**
 * Derive the namespaced groupId for a given spec + resourceKey. Single
 * source of truth — both notification-backend and dispatch callers go
 * through this helper. Defined here in common so plugin code never
 * computes it.
 */
export function subscriptionGroupId(
  spec: { ownerPlugin: string; localId: string },
  resourceKey: string,
): string {
  return `${spec.ownerPlugin}.${spec.localId}.${resourceKey}`;
}

export interface SubscriptionSpecInput<TResource> {
  localId: string;
  target: NotificationTarget<TResource>;
  display: SubscriptionDisplayMeta;
}

/**
 * Bind a plugin's id once and return a `defineSubscription` helper that
 * stamps every spec with `<pluginId>.<localId>`. Mirrors the existing
 * factory pattern in `builders.ts`.
 */
export function createSubscriptionFactory(pluginMetadata: PluginMetadataLike) {
  const pluginId = pluginMetadata.pluginId;

  function defineSubscription<TResource>(
    input: SubscriptionSpecInput<TResource>,
  ): NotificationSubscriptionSpec<TResource> {
    if (input.localId.includes(".")) {
      throw new Error(
        `Subscription localId must not contain '.', got ${JSON.stringify(input.localId)}`,
      );
    }
    return {
      specId: `${pluginId}.${input.localId}`,
      ownerPlugin: pluginId,
      localId: input.localId,
      target: input.target,
      display: input.display,
    };
  }

  return { defineSubscription };
}

/**
 * Wire-format for spec registration. Includes the target type id so the
 * backend can join known resources of that target onto the spec when
 * provisioning groups, without re-walking type info.
 */
export interface RegisteredSubscriptionSpecRecord {
  specId: string;
  ownerPlugin: string;
  localId: string;
  targetTypeId: string;
  display: SubscriptionDisplayMeta;
}

export function specToRegistration<TResource>(
  spec: NotificationSubscriptionSpec<TResource>,
): RegisteredSubscriptionSpecRecord {
  return {
    specId: spec.specId,
    ownerPlugin: spec.ownerPlugin,
    localId: spec.localId,
    targetTypeId: spec.target.targetTypeId,
    display: spec.display,
  };
}
