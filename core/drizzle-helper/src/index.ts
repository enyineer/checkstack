/**
 * Canonical charset for a `pluginId` (kept in sync with
 * `@checkstack/common`'s `PLUGIN_ID_REGEX`). Duplicated here as a literal so
 * this leaf helper stays dependency-free while still asserting the constraint:
 * lowercase letters, digits and single dashes, starting with a letter.
 */
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Generates the database schema name for a plugin.
 *
 * The returned name is interpolated into SQL identifiers (`search_path`,
 * `DROP SCHEMA`), so this is the last line of defense against a malformed or
 * hostile `pluginId` reaching SQL: it asserts the canonical charset and throws
 * rather than producing an unsafe schema name. Validation also happens at the
 * install boundary (`pluginIdSchema`); this guard ensures no code path can
 * bypass it.
 *
 * @param pluginId - The plugin identifier
 * @returns The database schema name in format "plugin_<pluginId>"
 * @throws If `pluginId` is not a safe identifier fragment.
 */
export function getPluginSchemaName(pluginId: string): string {
  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new Error(
      `Invalid pluginId ${JSON.stringify(pluginId)}: must be lowercase ` +
        `letters, numbers and single dashes, starting with a letter.`,
    );
  }
  return `plugin_${pluginId}`;
}
