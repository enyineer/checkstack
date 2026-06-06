import {
  FrontendPlugin,
  pluginRegistry,
} from "@checkstack/frontend-api";
import { loadRemote, registerRemotes } from "@module-federation/runtime";

/**
 * Module Federation remote name for a runtime plugin, derived deterministically
 * from its npm package name so the host and the scaffolded plugin's federation
 * config agree without coordination. MF remote names must be identifier-safe.
 * e.g. `@checkstackit/widget-frontend` -> `checkstackit_widget_frontend`.
 */
function mfRemoteName(packageName: string): string {
  return packageName.replace(/^@/, "").replaceAll(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Register a runtime plugin as a Module Federation remote (manifest served by
 * the backend at /assets/plugins/<pkg>/mf-manifest.json) and load its exposed
 * `./plugin` module. MF's share scope hands the remote the host's React /
 * Router / QueryClient / framework-api instances, and injects the remote's CSS.
 */
async function loadRemotePluginModule(packageName: string): Promise<unknown> {
  const name = mfRemoteName(packageName);
  registerRemotes([
    {
      name,
      entry: `/assets/plugins/${packageName}/mf-manifest.json`,
    },
  ]);
  return loadRemote(`${name}/plugin`);
}

function registerFromModule(mod: unknown, label: string): boolean {
  if (typeof mod !== "object" || mod === null) return false;
  const pluginExport = Object.values(mod as Record<string, unknown>).find(
    (exp): exp is FrontendPlugin => isFrontendPlugin(exp),
  );
  if (!pluginExport) {
    console.warn(`⚠️  No valid FrontendPlugin export found in ${label}`);
    return false;
  }
  console.log(`🔌 Registering plugin: ${pluginExport.metadata.pluginId}`);
  pluginRegistry.register(pluginExport);
  return true;
}

export async function loadPlugins(overrideModules?: Record<string, unknown>) {
  console.log("🔌 discovering plugins...");

  // 1. Fetch enabled plugins from backend
  try {
    const response = await fetch("/api/plugins");
    if (!response.ok) {
      console.error("Failed to fetch enabled plugins:", response.statusText);
      return;
    }
    const enabledPlugins: { name: string; path: string }[] =
      await response.json();

    // 2. Get all available local plugins using eager loading
    // This avoids dynamic import issues in production builds
    // Load from both core/ (essential) and plugins/ (providers)
    let modules: Record<string, unknown>;
    if (overrideModules) {
      modules = overrideModules;
    } else {
      const coreModules = import.meta.glob(
        "../../*-frontend/src/index.tsx",
        { eager: true },
      );

      const pluginModules = import.meta.glob(
        "../../../plugins/*-frontend/src/index.tsx",
        { eager: true },
      );

      modules = { ...coreModules, ...pluginModules };
    }

    console.log(
      `🔌 Found ${
        Object.keys(modules).length
      } locally available frontend plugins.`
    );

    // 3. Load and register enabled plugins
    const registeredNames = new Set<string>();

    // Phase 1: Local plugins (bundled into the host via eager glob — already
    // loaded). These share React/etc. with the host by virtue of being in the
    // same build.
    for (const [path, mod] of Object.entries(modules)) {
      try {
        if (typeof mod !== "object" || mod === null) continue;
        const pluginExport = Object.values(
          mod as Record<string, unknown>,
        ).find((exp): exp is FrontendPlugin => isFrontendPlugin(exp));
        if (pluginExport) {
          pluginRegistry.register(pluginExport);
          registeredNames.add(pluginExport.metadata.pluginId);
          console.log(
            `🔌 Registered local plugin: ${pluginExport.metadata.pluginId}`,
          );
        } else {
          console.warn(`⚠️  No valid FrontendPlugin export found in ${path}`);
        }
      } catch (error) {
        console.error(`❌ Failed to load local plugin from ${path}`, error);
      }
    }

    // Phase 2: Runtime (installed) plugins — loaded as Module Federation
    // remotes so they share the host's singletons.
    for (const plugin of enabledPlugins) {
      if (registeredNames.has(plugin.name)) continue;
      console.log(`🔌 Loading remote plugin: ${plugin.name}`);
      try {
        const mod = await loadRemotePluginModule(plugin.name);
        if (registerFromModule(mod, `remote plugin ${plugin.name}`)) {
          registeredNames.add(plugin.name);
        }
      } catch (error) {
        console.error(`❌ Failed to load remote plugin ${plugin.name}:`, error);
      }
    }
  } catch (error) {
    console.error("❌ Critical error loading plugins:", error);
  }
}

function isFrontendPlugin(candidate: unknown): candidate is FrontendPlugin {
  if (typeof candidate !== "object" || candidate === null) return false;

  const p = candidate as Record<string, unknown>;

  // Check for metadata with pluginId
  if (typeof p.metadata !== "object" || p.metadata === null) return false;
  const metadata = p.metadata as Record<string, unknown>;
  if (typeof metadata.pluginId !== "string") return false;

  // Must have at least one frontend-specific property
  return "extensions" in p || "routes" in p || "apis" in p;
}

/**
 * Load a single runtime plugin (for dynamic installation without a reload).
 *
 * @param packageName - The plugin's npm package name, matching the
 *   /assets/plugins/<packageName>/ path the backend serves.
 */
export async function loadSinglePlugin(packageName: string): Promise<void> {
  console.log(`🔌 Loading single plugin: ${packageName}`);
  try {
    const mod = await loadRemotePluginModule(packageName);
    registerFromModule(mod, packageName);
  } catch (error) {
    console.error(`❌ Failed to load plugin ${packageName}:`, error);
    throw error;
  }
}

/**
 * Unload a plugin at runtime (for dynamic deregistration). Removes it from the
 * registry so its routes/slots stop rendering. (The MF remote container stays
 * registered for the session; re-installing reuses it.)
 *
 * @param pluginId - The frontend plugin ID (e.g. "widget").
 */
export function unloadPlugin(pluginId: string): void {
  console.log(`🔌 Unloading plugin: ${pluginId}`);
  pluginRegistry.unregister(pluginId);
}
