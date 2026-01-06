import { mock } from "bun:test";
import type { Fetch } from "@checkmate-monitor/backend-api";

/**
 * Creates a mock Fetch instance suitable for unit testing.
 * This mock provides the fetch method and forPlugin helper for plugin-scoped requests.
 *
 * @returns A mock Fetch object
 *
 * @example
 * ```typescript
 * const mockFetch = createMockFetch();
 * const response = await mockFetch.forPlugin("catalog-backend").get("/entities");
 * ```
 */
export function createMockFetch(): Fetch {
  return {
    fetch: mock(() => Promise.resolve({ ok: true, text: () => "" })),
    forPlugin: mock(() => ({
      get: mock(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      ),
      post: mock(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      ),
      put: mock(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      ),
      patch: mock(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      ),
      delete: mock(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      ),
    })),
  } as unknown as Fetch;
}
