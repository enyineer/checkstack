import { pluginRegistry, type FrontendPlugin } from "@checkstack/frontend-api";
import type { RendererRemote } from "@checkstack/status-page-common";
import { loadRemote, registerRemotes } from "@module-federation/runtime";
import { mfRemoteName, remoteEntryFor } from "./mf-remote";

// Deliberately a separate, lighter narrower than plugin-loader's
// `isFrontendPlugin`: importing plugin-loader here would pull its eager
// `import.meta.glob` of every local plugin into the public bundle and defeat the
// admin/public code split. The source is the operator's own trusted plugin.
function asFrontendPlugin(mod: unknown): FrontendPlugin | undefined {
  if (typeof mod !== "object" || mod === null) return undefined;
  const candidate =
    "default" in mod ? (mod as { default: unknown }).default : mod;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "metadata" in candidate
  ) {
    return candidate as FrontendPlugin;
  }
  return undefined;
}

const loaded = new Set<string>();

/**
 * Load the renderer remotes a published page needs and register each into the
 * plugin registry, so `useStatusWidgetRenderers` picks up their contributed
 * renderers. Used ONLY by the minimal custom-domain public bundle, which loads
 * no plugins otherwise. Each package loads at most once; a failure is swallowed
 * per-remote (that block just renders nothing) so one broken remote cannot break
 * the page.
 *
 * SECURITY: the set of remotes comes entirely from the published page's widget
 * types (operator-controlled), never from visitor input. The loaded code is the
 * operator's own installed plugin (trusted, exactly as in the admin app), its
 * renderers are pure prop-only components, and the ONLY data endpoint reachable
 * on this locked-down origin is the public status read - so a loaded remote
 * cannot reach any other data even if it tried.
 */
export async function loadRendererRemotes(
  remotes: RendererRemote[],
): Promise<void> {
  // allSettled: each loader already catches its own error; this just makes
  // "never rejects, one bad remote can't break the page" explicit.
  await Promise.allSettled(
    remotes.map(async ({ packageName }) => {
      if (loaded.has(packageName)) return;
      loaded.add(packageName);
      try {
        const name = mfRemoteName(packageName);
        registerRemotes([{ name, entry: remoteEntryFor(packageName) }]);
        const mod = await loadRemote(`${name}/plugin`);
        const plugin = asFrontendPlugin(mod);
        if (plugin) pluginRegistry.register(plugin);
      } catch (error) {
        loaded.delete(packageName); // allow a retry on a later render
        console.error(
          `Failed to load status-page renderer remote ${packageName}`,
          error,
        );
      }
    }),
  );
}
