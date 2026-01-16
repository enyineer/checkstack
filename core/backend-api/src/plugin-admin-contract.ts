import { z } from "zod";
import { access, proc } from "@checkstack/common";

// ─────────────────────────────────────────────────────────────────────────────
// Access Rules
// ─────────────────────────────────────────────────────────────────────────────

export const pluginAdminAccess = {
  install: access("plugin", "manage", "Install new plugins from npm"),
  deregister: access("plugin", "manage", "Deregister (uninstall) plugins"),
};

export const pluginAdminAccessRules = [
  pluginAdminAccess.install,
  pluginAdminAccess.deregister,
];

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const pluginAdminContract = {
  /**
   * Install a plugin from npm and load it across all instances.
   */
  install: proc({
    operationType: "mutation",
    userType: "user",
    access: [pluginAdminAccess.install],
  })
    .input(
      z.object({
        packageName: z.string().min(1, "Package name is required"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        pluginId: z.string(),
        path: z.string(),
      })
    ),

  /**
   * Deregister a plugin across all instances.
   */
  deregister: proc({
    operationType: "mutation",
    userType: "user",
    access: [pluginAdminAccess.deregister],
  })
    .input(
      z.object({
        pluginId: z.string().min(1, "Plugin ID is required"),
        deleteSchema: z.boolean().default(false),
      })
    )
    .output(z.object({ success: z.boolean() })),
};
