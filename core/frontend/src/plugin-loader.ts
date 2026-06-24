import {
  FrontendPlugin,
  pluginRegistry,
} from "@checkstack/frontend-api";
import { loadRemote, registerRemotes } from "@module-federation/runtime";
import { mfRemoteName, remoteEntryFor } from "./mf-remote";

/**
 * Register a runtime plugin as a Module Federation remote (manifest served by
 * the backend at /assets/plugins/<pkg>/mf-manifest.json) and load its exposed
 * `./plugin` module. MF's share scope hands the remote the host's React /
 * Router / QueryClient / framework-api instances, and injects the remote's CSS.
 */
async function loadRemotePluginModule(packageName: string): Promise<unknown> {
  const name = mfRemoteName(packageName);
  registerRemotes([{ name, entry: remoteEntryFor(packageName) }]);
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

/**
 * Register the eager-bundled LOCAL plugins (`core/*-frontend` and
 * `plugins/*-frontend`).
 *
 * This is SYNCHRONOUS and does NO network: the modules are already in the host
 * bundle via `import.meta.glob({ eager: true })`, so registering them is just
 * iterating an in-memory map. `main.tsx` runs this BEFORE the first render so
 * the shell, nav, and local routes paint immediately — the remote plugins load
 * afterwards (see {@link loadRemotePlugins}).
 *
 * @param overrideModules - Stand-in module map for tests / the dev server
 *   (which mounts a single plugin under a synthetic path).
 */
/**
 * Register already-resolved local plugin modules synchronously. Used by the dev
 * server (a single mounted plugin) and tests, which pass a resolved module map.
 */
export function registerLocalPlugins(
  modules: Record<string, unknown>,
): void {
  for (const [path, mod] of Object.entries(modules)) {
    try {
      registerFromModule(mod, `local plugin ${path}`);
    } catch (error) {
      console.error(`❌ Failed to load local plugin from ${path}`, error);
    }
  }
}

/**
 * Lazily import and register the bundled local plugins AFTER first paint.
 *
 * The glob is NON-eager: each plugin's `index.tsx` is its own dynamic chunk, so
 * rendering the app shell does NOT wait on downloading every plugin (and their
 * eager slot components). They register reactively against the plugin registry
 * (a `useSyncExternalStore` source in `App.tsx`), so nav entries and routes
 * appear as each plugin's chunk arrives - the shell paints first.
 */
export async function loadLocalPlugins(): Promise<void> {
  const loaders = {
    ...import.meta.glob("../../*-frontend/src/index.tsx"),
    ...import.meta.glob("../../../plugins/*-frontend/src/index.tsx"),
  } as Record<string, () => Promise<unknown>>;

  console.log(
    `🔌 Loading ${Object.keys(loaders).length} local frontend plugins...`,
  );

  await Promise.all(
    Object.entries(loaders).map(async ([path, load]) => {
      try {
        registerFromModule(await load(), `local plugin ${path}`);
      } catch (error) {
        console.error(`❌ Failed to load local plugin from ${path}`, error);
      }
    }),
  );
}

/**
 * Load the runtime (installed) plugins as Module Federation remotes so they
 * share the host's singletons.
 *
 * The enabled list comes from the server-inlined bootstrap when available
 * (`main.tsx` passes `boot.enabledPlugins`), avoiding a `/api/plugins` round
 * trip; when omitted (the dev server / no inlined blob) it is fetched. Runs
 * AFTER the first render — remotes register reactively against the plugin
 * registry (a `useSyncExternalStore` source in `App.tsx`), so their routes and
 * nav entries appear without blocking first paint.
 */
export async function loadRemotePlugins({
  enabledPlugins,
}: { enabledPlugins?: { name: string; path: string }[] } = {}): Promise<void> {
  let list = enabledPlugins;
  if (!list) {
    try {
      const response = await fetch("/api/plugins");
      if (!response.ok) {
        console.error("Failed to fetch enabled plugins:", response.statusText);
        return;
      }
      list = (await response.json()) as { name: string; path: string }[];
    } catch (error) {
      console.error("❌ Failed to fetch enabled plugins:", error);
      return;
    }
  }

  const loaded = new Set<string>();
  for (const plugin of list) {
    if (loaded.has(plugin.name)) continue;
    console.log(`🔌 Loading remote plugin: ${plugin.name}`);
    try {
      const mod = await loadRemotePluginModule(plugin.name);
      if (registerFromModule(mod, `remote plugin ${plugin.name}`)) {
        loaded.add(plugin.name);
      }
    } catch (error) {
      console.error(`❌ Failed to load remote plugin ${plugin.name}:`, error);
    }
  }
}

/**
 * Backwards-compatible combined loader: register locals, then load remotes.
 *
 * Used by the dev server (`dev-main.tsx`) and tests. Production `main.tsx`
 * calls {@link registerLocalPlugins} and {@link loadRemotePlugins} separately
 * so it can render the shell BETWEEN the two phases.
 */
export async function loadPlugins(
  overrideModules?: Record<string, unknown>,
): Promise<void> {
  console.log("🔌 discovering plugins...");
  if (overrideModules) {
    registerLocalPlugins(overrideModules);
  } else {
    await loadLocalPlugins();
  }
  await loadRemotePlugins();
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
