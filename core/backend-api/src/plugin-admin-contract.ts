import { z } from "zod";
import { oc } from "@orpc/contract";
import type { ProcedureMetadata } from "@checkmate-monitor/common";
import type { Permission } from "@checkmate-monitor/common";

// ─────────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────────

export const pluginAdminPermissions = {
  install: {
    id: "plugin.install",
    description: "Install new plugins from npm",
  },
  deregister: {
    id: "plugin.deregister",
    description: "Deregister (uninstall) plugins",
  },
} as const satisfies Record<string, Permission>;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

const _base = oc.$meta<ProcedureMetadata>({});

export const pluginAdminContract = {
  /**
   * Install a plugin from npm and load it across all instances.
   */
  install: _base
    .meta({
      userType: "user",
      permissions: [pluginAdminPermissions.install.id],
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
  deregister: _base
    .meta({
      userType: "user",
      permissions: [pluginAdminPermissions.deregister.id],
    })
    .input(
      z.object({
        pluginId: z.string().min(1, "Plugin ID is required"),
        deleteSchema: z.boolean().default(false),
      })
    )
    .output(z.object({ success: z.boolean() })),
};
