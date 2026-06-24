import { describe, it, expect, mock, beforeAll, afterAll, beforeEach } from "bun:test";

// The loader registers each runtime (installed) plugin as a Module Federation
// remote (`registerRemotes`) and loads its exposed `./plugin` (`loadRemote`).
// Stub both so the test exercises the loader's wiring without a real federation
// host. `@module-federation/runtime` has exactly one importer in the repo
// (plugin-loader.ts) and no other test imports it, so this process-wide
// `mock.module` can't leak into another suite's expectations.
const registerRemotes = mock(
  (_remotes: Array<{ name: string; entry: string }>) => {},
);
const loadRemote = mock((id: string) => {
  // The host loads `<remoteName>/plugin`; hand back a valid FrontendPlugin.
  if (id === "remote_plugin/plugin") {
    return Promise.resolve({
      default: { metadata: { pluginId: "remote-plugin" }, extensions: [] },
    });
  }
  return Promise.resolve(undefined);
});

mock.module("@module-federation/runtime", () => ({
  registerRemotes,
  loadRemote,
}));

// Mock fetch for the enabled-plugins endpoint.
const mockFetch = mock((url: string) => {
  if (url === "/api/plugins") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ name: "remote-plugin", path: "/dist" }]),
    } as unknown as Response);
  }
  return Promise.resolve({ ok: false } as unknown as Response);
});

// bun test runs every file in ONE shared process, so leaving fetch overridden
// on `global` leaks into other files - scope it to this suite's lifecycle.
const originalFetch = global.fetch;

beforeAll(() => {
  (global as unknown as { fetch: typeof fetch }).fetch = mockFetch as never;
});

afterAll(() => {
  (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
});

describe("frontend loadPlugins", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    registerRemotes.mockClear();
    loadRemote.mockClear();
  });

  it("registers bundled plugins and loads enabled runtime plugins as MF remotes", async () => {
    const { pluginRegistry } = await import("@checkstack/frontend-api");
    // Dynamic import so the `mock.module` above is in effect for the loader.
    const { loadPlugins } = await import("./plugin-loader");

    pluginRegistry.reset();

    // Bundled (local) plugins arrive as already-resolved modules from the eager
    // `import.meta.glob`; the override stands in for that map.
    const bundledModules = {
      "../../../plugins/local-frontend/src/index.tsx": {
        default: { metadata: { pluginId: "local" }, extensions: [] },
      },
    };

    await loadPlugins(bundledModules);

    const ids = pluginRegistry
      .getPlugins()
      .map((p) => p.metadata.pluginId);
    // Bundled local plugin registered from the eager module map.
    expect(ids).toContain("local");
    // Runtime plugin loaded via MF and registered.
    expect(ids).toContain("remote-plugin");

    // The remote is registered under its identifier-safe name, pointing at the
    // backend-served manifest, and loaded via its exposed `./plugin`.
    expect(registerRemotes).toHaveBeenCalledWith([
      {
        name: "remote_plugin",
        entry: "/assets/plugins/remote-plugin/mf-manifest.json",
      },
    ]);
    expect(loadRemote).toHaveBeenCalledWith("remote_plugin/plugin");

    pluginRegistry.reset();
  });

  it("registerLocalPlugins registers bundled plugins synchronously with no fetch", async () => {
    const { pluginRegistry } = await import("@checkstack/frontend-api");
    const { registerLocalPlugins } = await import("./plugin-loader");

    pluginRegistry.reset();
    registerLocalPlugins({
      "../../../plugins/local-frontend/src/index.tsx": {
        default: { metadata: { pluginId: "local" }, extensions: [] },
      },
    });

    expect(
      pluginRegistry.getPlugins().map((p) => p.metadata.pluginId),
    ).toContain("local");
    // First-paint critical path must not touch the network.
    expect(mockFetch).not.toHaveBeenCalled();

    pluginRegistry.reset();
  });

  it("loadRemotePlugins uses the inlined enabledPlugins list without fetching /api/plugins", async () => {
    const { pluginRegistry } = await import("@checkstack/frontend-api");
    const { loadRemotePlugins } = await import("./plugin-loader");

    pluginRegistry.reset();
    await loadRemotePlugins({
      enabledPlugins: [{ name: "remote-plugin", path: "/dist" }],
    });

    // The inlined list is used directly — the /api/plugins round trip is gone.
    expect(mockFetch).not.toHaveBeenCalled();
    expect(loadRemote).toHaveBeenCalledWith("remote_plugin/plugin");
    expect(
      pluginRegistry.getPlugins().map((p) => p.metadata.pluginId),
    ).toContain("remote-plugin");

    pluginRegistry.reset();
  });
});
