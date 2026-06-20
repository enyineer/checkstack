import { z } from "zod";

/**
 * Canonical charset for a `pluginId`.
 *
 * A pluginId is interpolated into the plugin's Postgres schema name
 * (`plugin_<pluginId>`) and into `SET LOCAL search_path` / `DROP SCHEMA`
 * statements, so it MUST be a safe SQL identifier fragment: lowercase letters,
 * digits and single dashes, starting with a letter. This forbids quotes,
 * whitespace, and anything that could break out of a quoted identifier. The
 * pattern mirrors the slug pattern used elsewhere (e.g. status-page slugs).
 *
 * All shipped plugin ids already satisfy this, so enforcing it does not break
 * upgrades; it only rejects a hostile/malformed id before it can reach SQL.
 */
export const PLUGIN_ID_REGEX = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const pluginIdSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(
    PLUGIN_ID_REGEX,
    "pluginId must be lowercase letters, numbers and single dashes, starting with a letter",
  );

/**
 * Validate a pluginId against {@link pluginIdSchema}, throwing on a bad id.
 * Use at trust boundaries where a pluginId first enters (plugin registration /
 * install) so a malformed id can never flow into a SQL identifier.
 */
export function assertValidPluginId(pluginId: string): string {
  return pluginIdSchema.parse(pluginId);
}

/**
 * Plugin metadata interface for backend plugins.
 *
 * Each backend plugin should export a `pluginMetadata` object from `plugin-metadata.ts`
 * that implements this interface. This provides a single source of truth for:
 * - The pluginId (used by createBackendPlugin and drizzle schema generation)
 * - Other plugin metadata that may be needed at build time
 */
export interface PluginMetadata {
  /** The unique identifier for this plugin */
  pluginId: string;

  /**
   * Previous plugin IDs that this plugin was known by.
   * Used during schema migrations to rename old schemas to the new name.
   * Only needed when renaming a plugin that has already been deployed.
   */
  previousPluginIds?: string[];
}

/**
 * Helper function to create typed plugin metadata.
 * @param metadata The plugin metadata object
 * @returns The same object with proper typing
 */
export function definePluginMetadata<T extends PluginMetadata>(metadata: T): T {
  return metadata;
}

// ─────────────────────────────────────────────────────────────────────────────
// Install-time metadata (validated when a plugin is installed at runtime)
// ─────────────────────────────────────────────────────────────────────────────

export const pluginPackageTypeSchema = z.enum(["backend", "frontend", "common"]);
export type PluginPackageType = z.infer<typeof pluginPackageTypeSchema>;

/**
 * Author shape — matches standard package.json `author` / `contributors`
 * (string OR object form).
 */
export const pluginAuthorSchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
  }),
]);
export type PluginAuthor = z.infer<typeof pluginAuthorSchema>;

/**
 * `package.json#checkstack` block schema.
 *
 * Required:
 * - `type`: which kind of package this is.
 * - `pluginId`: the runtime plugin id (must match the source const).
 *
 * Optional:
 * - `bundle`: list of sibling package names that must install/uninstall together.
 *   Set on the *primary* package only.
 * - `usageInstructions`: markdown shown in the install UI.
 * - `allowInstallScripts`: opt in to running `postinstall` etc. for this plugin's
 *   `bun install`. Default false (we pass `--ignore-scripts`).
 */
export const pluginCheckstackBlockSchema = z.object({
  type: pluginPackageTypeSchema,
  pluginId: pluginIdSchema.optional(),
  bundle: z.array(z.string().min(1)).optional(),
  usageInstructions: z.string().optional(),
  allowInstallScripts: z.boolean().optional(),
});
export type PluginCheckstackBlock = z.infer<typeof pluginCheckstackBlockSchema>;

/**
 * Schema applied to the *full* package.json of a plugin at install time.
 *
 * We re-use standard package.json fields (name, version, description, author,
 * license, homepage, repository) and only require what's strictly necessary
 * for displaying + validating an installable plugin. Compatibility is *not*
 * declared explicitly — it's derived from the `dependencies` section at
 * install time (semver.satisfies against the platform's loaded
 * `@checkstack/*` package versions).
 */
export const installPackageMetadataSchema = z.object({
  name: z.string().min(1, "package.json `name` is required"),
  version: z.string().min(1, "package.json `version` is required"),
  description: z.string().min(1, "package.json `description` is required"),
  author: pluginAuthorSchema,
  contributors: z.array(pluginAuthorSchema).optional(),
  license: z.string().min(1, "package.json `license` is required"),
  homepage: z.string().url().optional(),
  repository: z
    .union([
      z.string(),
      z.object({
        type: z.string().optional(),
        url: z.string(),
      }),
    ])
    .optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  checkstack: pluginCheckstackBlockSchema,
});
export type InstallPackageMetadata = z.infer<typeof installPackageMetadataSchema>;

/**
 * Bundle manifest written into a `--bundle`-mode tarball.
 *
 * Structure:
 *   bundle.tgz
 *     bundle.json                ← this manifest
 *     packages/
 *       <pkg-1>-<version>.tgz
 *       <pkg-2>-<version>.tgz
 */
export const pluginBundleManifestSchema = z.object({
  bundleVersion: z.literal(1),
  primary: z.string().min(1),
  packages: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      tarball: z.string().min(1), // path inside the outer tarball
    }),
  ),
});
export type PluginBundleManifest = z.infer<typeof pluginBundleManifestSchema>;
