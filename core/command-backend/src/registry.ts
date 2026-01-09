import type { SearchResult } from "@checkmate-monitor/command-common";
import {
  qualifyPermissionId,
  type PluginMetadata,
  type Permission,
  type LucideIconName,
} from "@checkmate-monitor/common";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Context provided to search providers during search operations.
 */
export interface SearchContext {
  /** The user's permission IDs for filtering results */
  userPermissions: string[];
}

/**
 * A command definition for simple registration.
 * Permissions will be automatically qualified using the plugin's metadata.
 */
export interface CommandDefinition {
  /** Unique command ID (will be prefixed with plugin ID) */
  id: string;
  title: string;
  subtitle?: string;
  /** Icon name (Lucide PascalCase, e.g., 'AlertCircle') */
  iconName?: LucideIconName;
  /** Keyboard shortcuts, e.g. ["meta+shift+i", "ctrl+shift+i"] */
  shortcuts?: string[];
  /** Route to navigate to when executed */
  route: string;
  /** Permissions required (will be auto-qualified with plugin ID) */
  requiredPermissions?: Permission[];
}

/**
 * A backend search provider that contributes results to the command palette.
 */
export interface BackendSearchProvider {
  /** Unique identifier for this provider */
  id: string;
  /** Display name for the provider category */
  name: string;
  /** Higher priority = appears first in results (default: 0) */
  priority?: number;
  /**
   * Search function that returns results matching the query.
   * Results should NOT be pre-filtered by permissions - the registry handles that.
   */
  search: (
    query: string,
    context: SearchContext
  ) => Promise<SearchResult[]> | SearchResult[];
}

/**
 * Options for registering a search provider.
 */
export interface RegisterSearchProviderOptions {
  /** The plugin's metadata - used to qualify permission IDs */
  pluginMetadata: PluginMetadata;

  /**
   * Simple command definitions. These will be automatically:
   * - Converted to a search provider
   * - Have permissions qualified with pluginId
   * - Be searchable by title, subtitle, and category
   */
  commands?: CommandDefinition[];

  /**
   * Custom search provider for more complex search logic.
   * Use this for entity search (e.g., catalog systems).
   * Permissions in returned results will be auto-qualified.
   */
  provider?: Omit<BackendSearchProvider, "id"> & {
    /** Provider ID (will be prefixed with plugin ID) */
    id: string;
  };
}

// =============================================================================
// INTERNAL REGISTRY
// =============================================================================

const searchProviders = new Map<string, BackendSearchProvider>();

/**
 * Register a search provider with the command palette.
 *
 * This is the main API for plugins to contribute to command palette search.
 * Permissions are automatically qualified with the plugin's ID.
 *
 * @example Simple command registration:
 * ```ts
 * registerSearchProvider({
 *   pluginMetadata,
 *   commands: [
 *     {
 *       id: "create",
 *       title: "Create Incident",
 *       subtitle: "Report a new incident",
 *       iconName: "AlertCircle",
 *       shortcuts: ["meta+shift+i", "ctrl+shift+i"],
 *       route: "/incidents?action=create",
 *       requiredPermissions: [permissions.incidentManage],
 *     },
 *   ],
 * });
 * ```
 *
 * @example Custom entity provider:
 * ```ts
 * registerSearchProvider({
 *   pluginMetadata,
 *   provider: {
 *     id: "systems",
 *     name: "Systems",
 *     priority: 100,
 *     search: async (query) => {
 *       const systems = await db.select().from(schema.systems);
 *       return systems.filter(s => s.name.includes(query)).map(s => ({
 *         id: s.id,
 *         type: "entity",
 *         title: s.name,
 *         category: "Systems",
 *         route: `/catalog/systems/${s.id}`,
 *       }));
 *     },
 *   },
 * });
 * ```
 */
export function registerSearchProvider(
  options: RegisterSearchProviderOptions
): void {
  const { pluginMetadata, commands, provider } = options;

  // Register commands as a search provider
  if (commands && commands.length > 0) {
    const commandProvider = createCommandProvider(pluginMetadata, commands);
    searchProviders.set(commandProvider.id, commandProvider);
  }

  // Register custom provider with auto-qualified permissions
  if (provider) {
    const qualifiedProvider = createQualifiedProvider(pluginMetadata, provider);
    searchProviders.set(qualifiedProvider.id, qualifiedProvider);
  }
}

/**
 * Create a search provider from command definitions.
 */
function createCommandProvider(
  pluginMetadata: PluginMetadata,
  commands: CommandDefinition[]
): BackendSearchProvider {
  // Pre-qualify all permissions and build SearchResult objects
  const searchableCommands: SearchResult[] = commands.map((cmd) => ({
    id: `${pluginMetadata.pluginId}.${cmd.id}`,
    type: "command" as const,
    title: cmd.title,
    subtitle: cmd.subtitle,
    iconName: cmd.iconName,
    category: capitalize(pluginMetadata.pluginId),
    shortcuts: cmd.shortcuts,
    route: cmd.route,
    requiredPermissions: cmd.requiredPermissions?.map((perm) =>
      qualifyPermissionId(pluginMetadata, perm)
    ),
  }));

  return {
    id: `${pluginMetadata.pluginId}.commands`,
    name: `${capitalize(pluginMetadata.pluginId)} Commands`,
    priority: 80, // Commands have medium-high priority
    search: (query) => {
      const q = query.toLowerCase();

      // Return all if no query
      if (!q) return searchableCommands;

      // Filter by title, subtitle, or category
      return searchableCommands.filter(
        (cmd) =>
          cmd.title.toLowerCase().includes(q) ||
          cmd.subtitle?.toLowerCase().includes(q) ||
          cmd.category.toLowerCase().includes(q)
      );
    },
  };
}

/**
 * Wrap a custom provider to auto-qualify permissions in results.
 */
function createQualifiedProvider(
  pluginMetadata: PluginMetadata,
  provider: BackendSearchProvider
): BackendSearchProvider {
  return {
    ...provider,
    id: `${pluginMetadata.pluginId}.${provider.id}`,
    search: async (query, context) => {
      const results = await provider.search(query, context);

      // Auto-qualify permission IDs in results
      return results.map((result) => ({
        ...result,
        id: result.id.includes(".")
          ? result.id
          : `${pluginMetadata.pluginId}.${result.id}`,
        requiredPermissions: result.requiredPermissions?.map((permId) =>
          // If already qualified (contains the plugin ID prefix), leave it
          permId.startsWith(`${pluginMetadata.pluginId}.`)
            ? permId
            : `${pluginMetadata.pluginId}.${permId}`
        ),
      }));
    },
  };
}

/**
 * Capitalize first letter of a string.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Unregister a search provider.
 */
export function unregisterSearchProvider(providerId: string): void {
  searchProviders.delete(providerId);
}

/**
 * Unregister all search providers for a given plugin ID.
 * Called automatically when a plugin is deregistered.
 * @returns The number of providers removed
 */
export function unregisterProvidersByPluginId(pluginId: string): number {
  let removed = 0;
  for (const [id] of searchProviders) {
    if (id.startsWith(`${pluginId}.`)) {
      searchProviders.delete(id);
      removed++;
    }
  }
  return removed;
}

/**
 * Get all registered search providers, sorted by priority (descending).
 * @internal Used by the command router
 */
export function getSearchProviders(): BackendSearchProvider[] {
  return [...searchProviders.values()].toSorted(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
  );
}

/**
 * Clear all registrations. Useful for testing.
 */
export function clearRegistry(): void {
  searchProviders.clear();
}
