import { eq } from "drizzle-orm";
import { SafeDatabase } from "@checkstack/backend-api";
import { ORPCError } from "@orpc/server";
import { plugins } from "../schema";

/**
 * Validates that a plugin can be deregistered.
 * throws ORPCError if the plugin is not uninstallable or has dependents.
 */
export async function assertCanDeregister({
  pluginId,
  db,
}: {
  pluginId: string;
  db: SafeDatabase<Record<string, unknown>>;
}): Promise<void> {
  // 1. Check if plugin exists
  const pluginRows = await db
    .select()
    .from(plugins)
    .where(eq(plugins.name, pluginId));

  if (pluginRows.length === 0) {
    throw new ORPCError("NOT_FOUND", {
      message: `Plugin "${pluginId}" not found`,
    });
  }

  const plugin = pluginRows[0];

  // 2. Check isUninstallable flag
  if (!plugin.isUninstallable) {
    throw new ORPCError("FORBIDDEN", {
      message: `Plugin "${pluginId}" is a core platform component and cannot be uninstalled`,
    });
  }

  // 3. TODO: Check for dependent plugins (consumers of this plugin's services)
  // This would require tracking service dependencies at runtime
  // For now, we skip this check and let the deregistration proceed
}
