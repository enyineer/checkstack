/**
 * Generates the database schema name for a plugin.
 *
 * @param pluginId - The plugin identifier
 * @returns The database schema name in format "plugin_<pluginId>"
 */
export function getPluginSchemaName(pluginId: string): string {
  return `plugin_${pluginId}`;
}
