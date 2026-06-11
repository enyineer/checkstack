import type { InferClient } from "@checkstack/common";
import { CatalogApi } from "./rpc-contract";

/**
 * Verify that the given (typically USER-scoped) catalog client can READ every
 * listed system, and every MEMBER system of every listed group. Throws on the
 * first inaccessible resource. Catalog owns this check because it owns systems
 * and groups; status-page widgets that bind catalog resources delegate their
 * publish-time "cannot expose what you cannot see" gate to it.
 *
 * Groups are expanded to their members: a group can be visible while containing
 * systems the caller cannot read, which a group widget would otherwise expose.
 */
export async function assertCatalogResourcesReadable(args: {
  client: InferClient<typeof CatalogApi>;
  systemIds?: string[];
  groupIds?: string[];
}): Promise<void> {
  const systemIds = new Set(args.systemIds);
  if (args.groupIds && args.groupIds.length > 0) {
    const groups = await args.client.getGroups();
    const byId = new Map(groups.map((g) => [g.id, g]));
    for (const groupId of args.groupIds) {
      const group = byId.get(groupId);
      if (!group) {
        throw new Error(
          "You can only publish widgets bound to groups you can access.",
        );
      }
      for (const systemId of group.systemIds) systemIds.add(systemId);
    }
  }
  for (const systemId of systemIds) {
    const system = await args.client
      .getSystem({ systemId })
      .catch(() => null);
    if (!system) {
      throw new Error(
        "You can only publish widgets bound to systems you can access.",
      );
    }
  }
}
