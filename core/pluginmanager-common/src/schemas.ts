import { z } from "zod";
import {
  pluginSourceSchema,
  installPackageMetadataSchema,
  pluginCheckstackBlockSchema,
  pluginPackageTypeSchema,
} from "@checkstack/common";

// ─────────────────────────────────────────────────────────────────────────────
// Compatibility issue surfaced by `previewInstall` / re-validated on `install`.
// ─────────────────────────────────────────────────────────────────────────────

export const compatibilityIssueSchema = z.object({
  pluginName: z.string(),
  kind: z.enum([
    "missing-dependency",
    "version-mismatch",
    "platform-version-mismatch",
  ]),
  dependency: z.string(),
  declared: z.string(),
  actual: z.string().optional(),
  message: z.string(),
});
export type CompatibilityIssue = z.infer<typeof compatibilityIssueSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Preview-install / preview-uninstall result shapes.
// ─────────────────────────────────────────────────────────────────────────────

export const installPreviewSchema = z.object({
  /** Validated package.json of the primary package. */
  primary: installPackageMetadataSchema,
  /** Validated package.json for every package in the bundle (including primary). */
  packages: z.array(installPackageMetadataSchema),
  /** Compatibility issues — non-empty means install will be rejected. */
  compatibilityIssues: z.array(compatibilityIssueSchema),
  /** Aggregate tarball size in bytes (sum of all packages in the bundle). */
  totalSizeBytes: z.number().int().nonnegative(),
  /** True when at least one package has `checkstack.allowInstallScripts: true`. */
  hasInstallScripts: z.boolean(),
});
export type InstallPreview = z.infer<typeof installPreviewSchema>;

export const uninstallPreviewSchema = z.object({
  pluginName: z.string(),
  /** All sibling packages that share this plugin's bundleId. */
  siblings: z.array(z.string()),
  /** Other plugins (NOT in this bundle) that depend on this plugin. */
  dependents: z.array(z.string()),
  /** Will this drop the plugin's Postgres schema? */
  schemasToDrop: z.array(z.string()),
  /** How many plugin_configs rows will be deleted? */
  pluginConfigCount: z.number().int().nonnegative(),
});
export type UninstallPreview = z.infer<typeof uninstallPreviewSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Installed-plugin row returned from `list`.
// ─────────────────────────────────────────────────────────────────────────────

export const installedPluginSchema = z.object({
  name: z.string(),
  version: z.string(),
  type: pluginPackageTypeSchema,
  enabled: z.boolean(),
  isUninstallable: z.boolean(),
  isPrimary: z.boolean(),
  bundleId: z.string().nullable(),
  source: pluginSourceSchema.nullable(),
  metadata: z
    .object({
      description: z.string().optional(),
      author: z.unknown().optional(),
      license: z.string().optional(),
      homepage: z.string().optional(),
      repository: z.unknown().optional(),
      checkstack: pluginCheckstackBlockSchema.partial().optional(),
    })
    .partial()
    .optional(),
});
export type InstalledPlugin = z.infer<typeof installedPluginSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Audit/error event row.
// ─────────────────────────────────────────────────────────────────────────────

export const installEventActionEnum = z.enum(["install", "uninstall"]);
export type InstallEventAction = z.infer<typeof installEventActionEnum>;

export const installEventPhaseEnum = z.enum([
  "validate",
  "persist",
  "broadcast",
  "in-process-load",
  "in-process-unload",
  "destructive-cleanup",
  "audit",
]);
export type InstallEventPhase = z.infer<typeof installEventPhaseEnum>;

export const installEventStatusEnum = z.enum([
  "started",
  "succeeded",
  "failed",
]);
export type InstallEventStatus = z.infer<typeof installEventStatusEnum>;

export const installEventSchema = z.object({
  id: z.string(),
  pluginName: z.string().nullable(),
  bundleId: z.string().nullable(),
  action: installEventActionEnum,
  phase: installEventPhaseEnum,
  status: installEventStatusEnum,
  source: pluginSourceSchema.nullable(),
  error: z.string().nullable(),
  instanceId: z.string(),
  userId: z.string().nullable(),
  createdAt: z.string(),
});
export type InstallEvent = z.infer<typeof installEventSchema>;
