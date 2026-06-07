import type { ComponentType, ReactNode } from "react";
import type { AccessRule } from "@checkstack/common";
import { FrontendPlugin, Extension } from "./plugin";

/** Lazy page loader, as declared on a {@link PluginRoute}. */
type RouteLoader = () => Promise<{ default: ComponentType }>;

/**
 * Listener function for registry changes
 */
type RegistryListener = () => void;

/**
 * Resolved route information for runtime access.
 */
interface ResolvedRoute {
  id: string;
  path: string;
  pluginId: string;
  /** Exactly one of `load` (lazy) / `element` (eager) is set. */
  load?: RouteLoader;
  element?: ReactNode;
  title?: string;
  /**
   * The FULL access rule (not just its id) so the route guard can qualify it
   * (`{pluginId}.{id}`) against the user's granted ids AND apply manage->read
   * escalation. A bare id string could do neither.
   */
  accessRule?: AccessRule;
}

class PluginRegistry {
  private plugins: FrontendPlugin[] = [];
  // Immutable snapshot of `plugins`, rebuilt on every change. `getPlugins()`
  // returns this so callers (and `useSyncExternalStore`) get a referentially
  // stable value between changes and a NEW reference when the set changes —
  // `plugins` itself is mutated in place, so its reference never changes.
  private pluginsSnapshot: readonly FrontendPlugin[] = [];
  private extensions = new Map<string, Extension[]>();
  private routeMap = new Map<string, ResolvedRoute>();

  /**
   * Version counter that increments on every registry change.
   * Used by React components to trigger re-renders when plugins are added/removed.
   */
  private version = 0;
  private listeners: Set<RegistryListener> = new Set();

  /**
   * Validate and register routes from a plugin.
   */
  private registerRoutes(plugin: FrontendPlugin) {
    if (!plugin.routes) return;

    const pluginId = plugin.metadata.pluginId;

    for (const route of plugin.routes) {
      // Validate that route's pluginId matches the frontend plugin
      if (route.route.pluginId !== pluginId) {
        console.error(
          `❌ Route pluginId mismatch: route "${route.route.id}" has pluginId "${route.route.pluginId}" ` +
            `but plugin is "${pluginId}"`
        );
        throw new Error(
          `Route pluginId "${route.route.pluginId}" doesn't match plugin "${pluginId}"`
        );
      }

      const fullPath = `/${route.route.pluginId}${
        route.route.path.startsWith("/")
          ? route.route.path
          : `/${route.route.path}`
      }`;

      const resolvedRoute: ResolvedRoute = {
        id: route.route.id,
        path: fullPath,
        pluginId: route.route.pluginId,
        load: route.load,
        element: route.element,
        title: route.title,
        accessRule: route.accessRule,
      };

      // Add to route map for resolution
      this.routeMap.set(route.route.id, resolvedRoute);
    }
  }

  /**
   * Unregister routes from a plugin.
   */
  private unregisterRoutes(plugin: FrontendPlugin) {
    if (!plugin.routes) return;

    for (const route of plugin.routes) {
      this.routeMap.delete(route.route.id);
    }
  }

  register(plugin: FrontendPlugin) {
    const pluginId = plugin.metadata.pluginId;

    // Avoid duplicate registration
    if (this.plugins.some((p) => p.metadata.pluginId === pluginId)) {
      console.warn(`⚠️ Plugin ${pluginId} already registered`);
      return;
    }

    console.log(`🔌 Registering frontend plugin: ${pluginId}`);
    this.plugins.push(plugin);

    if (plugin.extensions) {
      for (const extension of plugin.extensions) {
        if (!this.extensions.has(extension.slot.id)) {
          this.extensions.set(extension.slot.id, []);
        }
        this.extensions.get(extension.slot.id)!.push(extension);
      }
    }

    this.registerRoutes(plugin);
    this.incrementVersion();
  }

  /**
   * Unregister a plugin by ID.
   * Removes the plugin and all its extensions from the registry.
   */
  unregister(pluginId: string): boolean {
    const pluginIndex = this.plugins.findIndex(
      (p) => p.metadata.pluginId === pluginId
    );
    if (pluginIndex === -1) {
      console.warn(`⚠️ Plugin ${pluginId} not found for unregistration`);
      return false;
    }

    const plugin = this.plugins[pluginIndex];
    console.log(`🔌 Unregistering frontend plugin: ${pluginId}`);

    // Remove plugin from list
    this.plugins.splice(pluginIndex, 1);

    // Remove extensions
    if (plugin.extensions) {
      for (const extension of plugin.extensions) {
        const slotExtensions = this.extensions.get(extension.slot.id);
        if (slotExtensions) {
          const extIndex = slotExtensions.findIndex(
            (e) => e.id === extension.id
          );
          if (extIndex !== -1) {
            slotExtensions.splice(extIndex, 1);
          }
        }
      }
    }

    this.unregisterRoutes(plugin);
    this.incrementVersion();
    return true;
  }

  /**
   * Check if a plugin is registered.
   */
  hasPlugin(pluginId: string): boolean {
    return this.plugins.some((p) => p.metadata.pluginId === pluginId);
  }

  getPlugins(): readonly FrontendPlugin[] {
    return this.pluginsSnapshot;
  }

  getExtensions(slotId: string): Extension[] {
    return this.extensions.get(slotId) || [];
  }

  /**
   * Get all routes for rendering in the router.
   */
  getAllRoutes() {
    return this.plugins.flatMap((plugin) => {
      return (plugin.routes || []).map((route) => {
        const fullPath = `/${route.route.pluginId}${
          route.route.path.startsWith("/")
            ? route.route.path
            : `/${route.route.path}`
        }`;

        return {
          path: fullPath,
          pluginId: route.route.pluginId,
          load: route.load,
          element: route.element,
          title: route.title,
          accessRule: route.accessRule,
          // Resolved sidebar entry (defaults applied) for routes that opt in.
          // `accessRule` here is the EFFECTIVE rule object (nav override, else
          // the route's own rule) the sidebar gates visibility on.
          nav: route.nav
            ? {
                group: route.nav.group,
                icon: route.nav.icon,
                label: route.nav.label ?? route.title ?? route.route.id,
                order: route.nav.order ?? 0,
                accessRule: route.nav.accessRule ?? route.accessRule,
                // Dynamic visibility predicate (e.g. Infrastructure: any
                // readable tab; per-user entries: authenticated) — passed
                // through so the sidebar can evaluate it.
                isVisible: route.nav.isVisible,
              }
            : undefined,
        };
      });
    });
  }

  /**
   * Resolve a route by its ID to get the full path.
   *
   * @param routeId - Route ID in format "{pluginId}.{routeName}"
   * @param params - Optional path parameters to substitute
   * @returns The resolved full path, or undefined if not found
   */
  resolveRoute(
    routeId: string,
    params?: Record<string, string>
  ): string | undefined {
    const route = this.routeMap.get(routeId);
    if (!route) {
      console.warn(`⚠️ Route "${routeId}" not found in registry`);
      return undefined;
    }

    if (!params) {
      return route.path;
    }

    // Substitute path parameters
    let result = route.path;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(`:${key}`, value);
    }
    return result;
  }

  /**
   * Get the current version number.
   * Increments on every register/unregister.
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Subscribe to registry changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private incrementVersion() {
    this.version++;
    // Rebuild the immutable snapshot so external subscribers see a new
    // reference (required for useSyncExternalStore / useMemo to recompute).
    this.pluginsSnapshot = [...this.plugins];
    for (const listener of this.listeners) {
      listener();
    }
  }

  reset() {
    this.plugins = [];
    this.extensions.clear();
    this.routeMap.clear();
    this.incrementVersion();
  }
}

export const pluginRegistry = new PluginRegistry();
