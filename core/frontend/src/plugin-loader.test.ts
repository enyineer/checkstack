import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  beforeEach,
  afterAll,
} from "bun:test";
import { loadPlugins } from "./plugin-loader";

// Note: We don't mock @checkstack/frontend-api module-wide here because
// it causes test isolation issues with other tests that use the real pluginRegistry.
// Instead, we just verify behavior based on the function's outputs.

// Mock fetch. The `typeof url === "string"` guard means a stray non-string
// argument can never throw (defensive; the override is also scoped to this
// suite's lifecycle below).
const mockFetch = mock((url: string) => {
  if (url === "/api/plugins") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ name: "remote-plugin", path: "/dist" }]),
    } as unknown as Response);
  }
  // Mock HEAD request for CSS
  if (typeof url === "string" && url.endsWith(".css")) {
    return Promise.resolve({ ok: true } as unknown as Response);
  }
  return Promise.resolve({ ok: false } as unknown as Response);
});

// bun test runs every file in ONE shared process, so leaving these overrides on
// `global` leaks into other files - e.g. the real-HTTP backend auth tests would
// hit this mock instead of the real fetch and crash. Scope them to this suite.
const originalFetch = global.fetch;
const originalDocument = global.document;

beforeAll(() => {
  (global as unknown as { fetch: typeof fetch }).fetch = mockFetch as never;
  global.document = {
    createElement: mock(() => ({})),
    head: {
      append: mock(),
    },
  } as unknown as Document;
});

afterAll(() => {
  (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  (global as unknown as { document: Document }).document = originalDocument;
});

describe("frontend loadPlugins", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("should discover and register local and remote plugins", async () => {
    // Import the real pluginRegistry to verify registration
    const { pluginRegistry } = await import("@checkstack/frontend-api");

    // Reset registry before test
    pluginRegistry.reset();

    // With eager loading, modules are already resolved objects, not async functions
    const mockModules = {
      "../../../plugins/local-frontend/src/index.tsx": {
        default: { metadata: { pluginId: "local" }, extensions: [] },
      },
    };

    // We also need to mock dynamic import() for remote plugins
    mock.module("/assets/plugins/remote-plugin/index.js", () => ({
      default: { metadata: { pluginId: "remote-plugin" }, extensions: [] },
    }));

    await loadPlugins(mockModules);

    // Verify plugins are registered
    const registeredPlugins = pluginRegistry.getPlugins();
    expect(registeredPlugins.some((p) => p.metadata.pluginId === "local")).toBe(
      true
    );

    // Verify CSS loading was attempted
    expect(mockFetch).toHaveBeenCalledWith(
      "/assets/plugins/remote-plugin/index.css",
      expect.objectContaining({ method: "HEAD" })
    );

    // Clean up
    pluginRegistry.reset();
  });
});
