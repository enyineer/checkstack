import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// PluginSource — discriminated union describing where a plugin came from.
// One installer per `type`. Persisted on the `plugins` row so fresh-instance
// bootstrap and reinstall can recreate the artifact from the same source.
//
// Lives in `@checkstack/common` (not `backend-api`) so it can be referenced
// from contracts (which must remain importable from frontend & common
// packages).
// ─────────────────────────────────────────────────────────────────────────────

export const npmPluginSourceSchema = z.object({
  type: z.literal("npm"),
  packageName: z.string().min(1),
  version: z.string().optional(),
  registry: z.string().url().optional(),
});
export type NpmPluginSource = z.infer<typeof npmPluginSourceSchema>;

export const tarballPluginSourceSchema = z.object({
  type: z.literal("tarball"),
  /**
   * The plugin_artifacts row id. The tarball bytes themselves live in
   * Postgres — only the artifact reference is stored on the `plugins` row.
   * On fresh-instance bootstrap, this is what's used to re-fetch the bytes.
   */
  artifactId: z.string().min(1),
  /** Original filename for display in the UI. */
  filename: z.string().optional(),
});
export type TarballPluginSource = z.infer<typeof tarballPluginSourceSchema>;

export const githubPluginSourceSchema = z.object({
  type: z.literal("github"),
  owner: z.string().min(1),
  repo: z.string().min(1),
  tag: z.string().min(1),
  /**
   * Optional explicit asset filename. When omitted, the installer picks the
   * single `.tgz` asset on the release (and errors if there are zero or many).
   */
  assetName: z.string().optional(),
  /**
   * Optional API base URL for GitHub Enterprise installs (e.g.
   * `https://github.example.com/api/v3`). When omitted, the public
   * `https://api.github.com` endpoint is used. Asset download URLs are
   * always taken from the release response, so they automatically point
   * at the same host as the API.
   */
  apiBaseUrl: z.string().url().optional(),
  /**
   * Optional name of an env var holding a Personal Access Token. Defaults
   * to `GITHUB_TOKEN`. Useful when the platform needs to talk to several
   * different GitHub instances with different tokens.
   */
  tokenEnvVar: z.string().optional(),
});
export type GithubPluginSource = z.infer<typeof githubPluginSourceSchema>;

export const catalogPluginSourceSchema = z.object({
  type: z.literal("catalog"),
  catalogId: z.string().min(1),
});
export type CatalogPluginSource = z.infer<typeof catalogPluginSourceSchema>;

export const pluginSourceSchema = z.discriminatedUnion("type", [
  npmPluginSourceSchema,
  tarballPluginSourceSchema,
  githubPluginSourceSchema,
  catalogPluginSourceSchema,
]);
export type PluginSource = z.infer<typeof pluginSourceSchema>;
