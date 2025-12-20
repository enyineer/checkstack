import { FrontendPlugin } from "@checkmate/frontend-api";
import { pluginRegistry } from "./plugin-registry";

export async function loadPlugins(
  overrideModules?: Record<string, () => Promise<unknown>>
) {
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

    // 2. Glob all available local plugins
    // We expect plugins to be in ../../plugins/*/src/index.tsx
    // The key will be the relative path
    const modules =
      overrideModules ||
      // @ts-expect-error - Vite specific property
      import.meta.glob("../../../plugins/*-frontend/src/index.tsx");

    console.log(
      `🔌 Found ${
        Object.keys(modules).length
      } locally available frontend plugins.`
    );

    // 3. Load and register enabled plugins
    const registeredNames = new Set<string>();

    // Phase 1: Local plugins (bundled)
    for (const [path, loader] of Object.entries(modules)) {
      try {
        const mod = await (loader as () => Promise<unknown>)();

        if (typeof mod !== "object" || mod === null) {
          continue;
        }

        const pluginExport = Object.values(mod as Record<string, unknown>).find(
          (exp): exp is FrontendPlugin => isFrontendPlugin(exp)
        );

        if (pluginExport) {
          console.log(`🔌 Registering local plugin: ${pluginExport.name}`);
          pluginRegistry.register(pluginExport);
          registeredNames.add(pluginExport.name);
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
            console.log(
              `🔌 Registering enabled remote plugin: ${pluginExport.name}`
            );
            pluginRegistry.register(pluginExport);
            registeredNames.add(pluginExport.name);
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
  if (typeof p.name !== "string") return false;

  // Basic check for frontend-specific properties
  return (
    p.name.endsWith("-frontend") ||
    "extensions" in p ||
    "routes" in p ||
    "navItems" in p
  );
}
