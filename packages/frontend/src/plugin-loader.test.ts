import { describe, it, expect, mock, beforeEach } from "bun:test";
import { loadPlugins } from "./plugin-loader";
import { pluginRegistry } from "@checkmate/frontend-api";

// Mock pluginRegistry
mock.module("@checkmate/frontend-api", () => ({
  pluginRegistry: {
    register: mock(),
  },
}));

// Mock fetch
const mockFetch = mock((url: string) => {
  if (url === "/api/plugins") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ name: "remote-plugin", path: "/dist" }]),
    } as unknown as Response);
  }
  // Mock HEAD request for CSS
  if (url.endsWith(".css")) {
    return Promise.resolve({ ok: true } as unknown as Response);
  }
  return Promise.resolve({ ok: false } as unknown as Response);
});

(global as any).fetch = mockFetch;

// Mock document
global.document = {
  createElement: mock(() => ({})),
  head: {
    append: mock(),
  },
} as unknown as Document;

describe("frontend loadPlugins", () => {
  beforeEach(() => {
    mock.restore(); // Optional but good practice if needed, though we use mock.module
    (pluginRegistry.register as any).mockClear();
    mockFetch.mockClear();
  });

  it("should discover and register local and remote plugins", async () => {
    const mockModules = {
      "../../../plugins/local-frontend/src/index.tsx": async () => ({
        default: { name: "local-frontend", extensions: [] },
      }),
    };

    // We also need to mock dynamic import() for remote plugins
    mock.module("/assets/plugins/remote-plugin/index.js", () => ({
      default: { name: "remote-plugin", extensions: [] },
    }));

    await loadPlugins(mockModules);

    // Verify local plugin registered
    expect(pluginRegistry.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: "local-frontend" })
    );

    // Verify remote plugin registered
    expect(pluginRegistry.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: "remote-plugin" })
    );

    // Verify CSS loading
    expect(mockFetch).toHaveBeenCalledWith(
      "/assets/plugins/remote-plugin/index.css",
      expect.objectContaining({ method: "HEAD" })
    );
  });
});
