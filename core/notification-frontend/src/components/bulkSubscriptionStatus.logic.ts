import { subscriptionGroupId } from "@checkstack/notification-common";

/**
 * Pure helper that computes the FULL set of primary subscription group ids for
 * a batch of visible resources, so the catalog browse view can fetch every
 * bell's subscription status in ONE `getMySubscriptionStatus` request instead of
 * one per bell (the N+1 this removes).
 *
 * Kept React- and network-free so the group-id fan-out is unit-testable in
 * isolation. Each resource contributes one primary group id per registered spec
 * whose `targetTypeId` matches the resource's target type (mirroring the
 * per-bell `specs.filter(...).map(subscriptionGroupId)` the manager does today).
 * The result is deduplicated and order-stable (resource order, then spec order).
 */
export function unionPrimaryGroupIds({
  specs,
  resources,
}: {
  specs: ReadonlyArray<{
    targetTypeId: string;
    ownerPlugin: string;
    localId: string;
  }>;
  resources: ReadonlyArray<{ targetTypeId: string; resourceKey: string }>;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const resource of resources) {
    for (const spec of specs) {
      if (spec.targetTypeId !== resource.targetTypeId) continue;
      const id = subscriptionGroupId(spec, resource.resourceKey);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
