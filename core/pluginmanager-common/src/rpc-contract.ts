import { z } from "zod";
import {
  createClientDefinition,
  proc,
  pluginSourceSchema,
} from "@checkstack/common";
import { pluginManagerAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  installPreviewSchema,
  uninstallPreviewSchema,
  installedPluginSchema,
  installEventSchema,
} from "./schemas";

// Confirmation tokens: the UI must echo back a typed phrase before destructive
// or potentially-malicious mutations are accepted. Mirrors the strong typed
// confirmation modal pattern used in the install/uninstall UI.
const installConfirmTokenSchema = z
  .string()
  .min(1, "Typed confirmation is required");
const uninstallConfirmTokenSchema = z
  .string()
  .min(1, "Typed confirmation is required");

export const pluginManagerContract = {
  /**
   * List all installed plugins (local monorepo + runtime-installed).
   */
  list: proc({
    operationType: "query",
    userType: "user",
    access: [pluginManagerAccess.view],
  })
    .input(z.void())
    .output(z.object({ plugins: z.array(installedPluginSchema) })),

  /**
   * Resolve a `PluginSource` to its full bundle metadata + compatibility
   * issues. Performs no destructive ops — pure preview for the UI's
   * typed-confirmation modal.
   */
  previewInstall: proc({
    operationType: "mutation",
    userType: "user",
    access: [pluginManagerAccess.install],
  })
    .input(z.object({ source: pluginSourceSchema }))
    .output(installPreviewSchema),

  /**
   * Install a plugin (or bundle) from a source. Re-runs validation and
   * compatibility — the preview is non-binding. Persists the artifact to
   * `plugin_artifacts` and broadcasts to all instances.
   */
  install: proc({
    operationType: "mutation",
    userType: "user",
    access: [pluginManagerAccess.install],
  })
    .input(
      z.object({
        source: pluginSourceSchema,
        confirm: installConfirmTokenSchema,
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        bundleId: z.string().nullable(),
        installedPackages: z.array(z.string()),
      }),
    ),

  /**
   * Resolve a plugin id to the cleanup picture: siblings, dependents, what
   * data will be deleted. Used by the uninstall typed-confirmation modal.
   */
  previewUninstall: proc({
    operationType: "query",
    userType: "user",
    access: [pluginManagerAccess.uninstall],
  })
    .input(z.object({ pluginName: z.string().min(1) }))
    .output(uninstallPreviewSchema),

  /**
   * Uninstall a plugin (and its bundle siblings). Originator owns destructive
   * cleanup; receiving instances do in-process teardown only.
   */
  uninstall: proc({
    operationType: "mutation",
    userType: "user",
    access: [pluginManagerAccess.uninstall],
  })
    .input(
      z.object({
        pluginName: z.string().min(1),
        deleteSchema: z.boolean(),
        deleteConfigs: z.boolean(),
        cascade: z.boolean(),
        confirm: uninstallConfirmTokenSchema,
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        uninstalledPackages: z.array(z.string()),
      }),
    ),

  /**
   * Audit/error event log. Used by the admin Events page to surface partial
   * failures (originator died mid-install, instance failed in-process load,
   * etc.) for manual remediation.
   */
  events: proc({
    operationType: "query",
    userType: "user",
    access: [pluginManagerAccess.view],
  })
    .input(
      z.object({
        pluginName: z.string().optional(),
        limit: z.number().int().positive().max(500).default(100),
      }),
    )
    .output(z.object({ events: z.array(installEventSchema) })),
};

export type PluginManagerContract = typeof pluginManagerContract;

export const PluginManagerApi = createClientDefinition(
  pluginManagerContract,
  pluginMetadata,
);
