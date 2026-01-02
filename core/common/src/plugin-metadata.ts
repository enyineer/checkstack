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
