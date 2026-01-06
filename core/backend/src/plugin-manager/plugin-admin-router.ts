import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  type RpcContext,
} from "@checkmate-monitor/backend-api";
import { pluginAdminContract } from "@checkmate-monitor/backend-api";
import type { PluginManager } from "../plugin-manager";
import type { PluginInstaller } from "@checkmate-monitor/backend-api";
import { db } from "../db";
import { plugins } from "../schema";
import { eq } from "drizzle-orm";
import { rootLogger } from "../logger";

// ─────────────────────────────────────────────────────────────────────────────
// Router Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createPluginAdminRouter({
  pluginManager,
  installer,
}: {
  pluginManager: PluginManager;
  installer: PluginInstaller;
}) {
  const impl = implement(pluginAdminContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

  return impl.router({
    install: impl.install.handler(async ({ input }) => {
      const { packageName } = input;
      rootLogger.info(`📦 Installing plugin: ${packageName}`);

      // 1. npm install to filesystem
      const result = await installer.install(packageName);

      // 2. Insert/update in DB with isUninstallable=true (remote plugin)
      await db
        .insert(plugins)
        .values({
          name: result.name,
          path: result.path,
          enabled: true,
          isUninstallable: true, // Remote plugins can be uninstalled
          type: "backend",
        })
        .onConflictDoUpdate({
          target: [plugins.name],
          set: { path: result.path, enabled: true },
        });

      // 3. Broadcast to all instances to load the plugin
      await pluginManager.requestInstallation(result.name, result.path);

      return {
        success: true,
        pluginId: result.name,
        path: result.path,
      };
    }),

    deregister: impl.deregister.handler(async ({ input }) => {
      const { pluginId, deleteSchema } = input;
      rootLogger.info(`🗑️ Deregistering plugin: ${pluginId}`);

      // Check if plugin exists and is uninstallable
      const existing = await db
        .select()
        .from(plugins)
        .where(eq(plugins.name, pluginId))
        .limit(1);

      if (existing.length === 0) {
        throw new Error(`Plugin ${pluginId} not found`);
      }

      if (!existing[0].isUninstallable) {
        throw new Error(
          `Plugin ${pluginId} is a core plugin and cannot be deregistered`
        );
      }

      // Broadcast to all instances to deregister
      await pluginManager.requestDeregistration(pluginId, { deleteSchema });

      return { success: true };
    }),
  });
}
