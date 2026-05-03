import {
  FrontendPlugin,
  pluginRegistry,
} from "@checkstack/frontend-api";

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

    // Phase 1: Local plugins (bundled with eager loading - already loaded)
    const entries = Object.entries(modules);

    for (const [path, mod] of entries) {
      try {
        if (typeof mod !== "object" || mod === null) {
          continue;
        }

        const pluginExport = Object.values(mod as Record<string, unknown>).find(
          (exp): exp is FrontendPlugin => isFrontendPlugin(exp)
        );

        if (pluginExport) {
          const pluginId = pluginExport.metadata.pluginId;
          console.log(`🔌 Registering local plugin: ${pluginId}`);
          pluginRegistry.register(pluginExport);
          registeredNames.add(pluginId);
        } else {
          console.warn(`⚠️  No valid FrontendPlugin export found in ${path}`);
        }
      } catch (error) {
        console.error(`❌ Failed to load local plugin from ${path}`, error);
      }
    }

    // Phase 2: Remote plugins (runtime)
    for (const plugin of enabledPlugins) {
      if (!registeredNames.has(plugin.name)) {
        console.log(`🔌 Attempting to load remote plugin: ${plugin.name}`);
        try {
          // 1. Load CSS if it exists
          const remoteCssUrl = `/assets/plugins/${plugin.name}/index.css`;
          try {
            const cssCheck = await fetch(remoteCssUrl, { method: "HEAD" });
            if (cssCheck.ok) {
              console.log(`🎨 Loading remote styles for: ${plugin.name}`);
              const link = document.createElement("link");
              link.rel = "stylesheet";
              link.href = remoteCssUrl;
              document.head.append(link);
            }
          } catch (error) {
            console.debug(`No separate CSS found for ${plugin.name}`, error);
          }

          // 2. Load JS entry point
          const remoteUrl = `/assets/plugins/${plugin.name}/index.js`;
          const mod = await import(/* @vite-ignore */ remoteUrl);

          const pluginExport = Object.values(
            mod as Record<string, unknown>
          ).find((exp): exp is FrontendPlugin => isFrontendPlugin(exp));

          if (pluginExport) {
            const pluginId = pluginExport.metadata.pluginId;
            console.log(`🔌 Registering enabled remote plugin: ${pluginId}`);
            pluginRegistry.register(pluginExport);
            registeredNames.add(pluginId);
          } else {
            console.warn(
              `⚠️  No valid FrontendPlugin export found for remote plugin ${plugin.name}`
            );
          }
        } catch (error) {
          console.error(
            `❌ Failed to load remote plugin ${plugin.name}:`,
            error
          );
        }
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
 * Load a single plugin at runtime (for dynamic installation).
 * Fetches the plugin from the backend and registers it.
 *
 * @param pluginId - The frontend plugin ID (e.g., "my-plugin-frontend")
 */
export async function loadSinglePlugin(pluginId: string): Promise<void> {
  console.log(`🔌 Loading single plugin: ${pluginId}`);

  // Skip if already registered
  if (pluginRegistry.hasPlugin(pluginId)) {
    console.warn(`⚠️ Plugin ${pluginId} already registered`);
    return;
  }

  try {
    // 1. Load CSS if it exists
    const remoteCssUrl = `/assets/plugins/${pluginId}/index.css`;
    try {
      const cssCheck = await fetch(remoteCssUrl, { method: "HEAD" });
      if (cssCheck.ok) {
        console.log(`🎨 Loading remote styles for: ${pluginId}`);
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = remoteCssUrl;
        link.id = `plugin-css-${pluginId}`;
        document.head.append(link);
      }
    } catch (error) {
      console.debug(`No separate CSS found for ${pluginId}`, error);
    }

    // 2. Load JS entry point
    const remoteUrl = `/assets/plugins/${pluginId}/index.js`;
    const mod = await import(/* @vite-ignore */ remoteUrl);

    const pluginExport = Object.values(mod as Record<string, unknown>).find(
      (exp): exp is FrontendPlugin => isFrontendPlugin(exp)
    );

    if (pluginExport) {
      const pluginId = pluginExport.metadata.pluginId;
      console.log(`🔌 Registering plugin: ${pluginId}`);
      pluginRegistry.register(pluginExport);
    } else {
      console.warn(`⚠️ No valid FrontendPlugin export found for ${pluginId}`);
    }
  } catch (error) {
    console.error(`❌ Failed to load plugin ${pluginId}:`, error);
    throw error;
  }
}

/**
 * Unload a plugin at runtime (for dynamic deregistration).
 * Removes the plugin from the registry and cleans up CSS.
 *
 * @param pluginId - The frontend plugin ID (e.g., "my-plugin-frontend")
 */
export function unloadPlugin(pluginId: string): void {
  console.log(`🔌 Unloading plugin: ${pluginId}`);

  // Remove from registry
  pluginRegistry.unregister(pluginId);

  // Remove CSS if we added it
  const cssLink = document.querySelector(`#plugin-css-${pluginId}`);
  if (cssLink) {
    cssLink.remove();
  }
}
