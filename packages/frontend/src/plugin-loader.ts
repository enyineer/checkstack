import { FrontendPlugin } from "@checkmate/frontend-api";
import { pluginRegistry } from "./plugin-registry";

export async function loadPlugins() {
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
    const enabledNames = new Set(enabledPlugins.map((p) => p.name));

    // 2. Glob all available local plugins
    // We expect plugins to be in ../../plugins/*/src/index.tsx
    // The key will be the relative path
    // @ts-expect-error - Vite specific property
    const modules = import.meta.glob("../../plugins/*/src/index.tsx");

    console.log(
      `🔌 Found ${Object.keys(modules).length} locally available plugins.`
    );

    // 3. Load and register enabled plugins
    for (const [path, loader] of Object.entries(modules)) {
      try {
        const mod = await (loader as () => Promise<unknown>)();

        if (typeof mod !== "object" || mod === null) {
          continue;
        }

        // Find the export that matches FrontendPlugin shape
        const pluginExport = Object.values(mod as Record<string, unknown>).find(
          (exp): exp is FrontendPlugin => isFrontendPlugin(exp)
        );

        if (pluginExport) {
          if (enabledNames.has(pluginExport.name)) {
            console.log(`🔌 Registering enabled plugin: ${pluginExport.name}`);
            pluginRegistry.register(pluginExport);
          } else {
            console.debug(`🔌 Skipping disabled plugin: ${pluginExport.name}`);
          }
        } else {
          console.warn(`⚠️  No valid FrontendPlugin export found in ${path}`);
        }
      } catch (error) {
        console.error(`❌ Failed to load plugin from ${path}`, error);
      }
    }
  } catch (error) {
    console.error("❌ Critical error loading plugins:", error);
  }
}

function isFrontendPlugin(candidate: unknown): candidate is FrontendPlugin {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "name" in candidate &&
    typeof (candidate as Record<string, unknown>).name === "string" &&
    ("extensions" in candidate || "routes" in candidate)
  );
}
