/**
 * Cross-plugin resource resolution.
 *
 * Team grants are stored as opaque `(resourceType, resourceId)` rows. The auth
 * backend (which serves the Teams admin UI) needs to turn those ids into human
 * names, and to let an admin SEARCH a plugin's resources to grant a team access
 * to one — but it must not depend on catalog/healthcheck/etc. (no reverse deps).
 *
 * Each owning plugin registers a {@link ResourceResolver} for its team-scopable
 * resource types into the shared {@link ResourceResolverRegistry} at init time.
 * The registry is an in-process singleton; checkstack is a modular monolith, so
 * every pod loads all plugins and builds an identical registry — a lookup is
 * deterministic on every pod (no cross-pod state).
 */
export interface ResourceResolver {
  /**
   * Resolve resource ids of this type to display names. Unknown ids may be
   * omitted from the returned map (the caller falls back to showing the id).
   */
  resolveNames(resourceIds: string[]): Promise<Map<string, string>>;

  /**
   * Search resources of this type by a free-text query, for the "grant a team
   * access to a resource" picker. Returns at most `limit` matches.
   */
  search(query: string, limit: number): Promise<Array<{ id: string; name: string }>>;
}

/**
 * Registry of {@link ResourceResolver}s keyed by qualified resource type
 * (`{pluginId}.{resource}`, e.g. "catalog.system"). Plugins call `register`
 * in their init; the auth backend reads via `get`.
 */
export class ResourceResolverRegistry {
  private readonly resolvers = new Map<string, ResourceResolver>();

  register(resourceType: string, resolver: ResourceResolver): void {
    this.resolvers.set(resourceType, resolver);
  }

  get(resourceType: string): ResourceResolver | undefined {
    return this.resolvers.get(resourceType);
  }

  has(resourceType: string): boolean {
    return this.resolvers.has(resourceType);
  }

  resolverTypes(): string[] {
    return [...this.resolvers.keys()];
  }
}
