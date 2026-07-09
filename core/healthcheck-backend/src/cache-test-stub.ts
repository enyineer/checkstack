import { mock } from "bun:test";
import type { HealthCheckCache } from "./cache";

/**
 * A no-op {@link HealthCheckCache} for tests that need to satisfy the router /
 * executor `cache` dependency without exercising real caching. Every method is a
 * `bun:test` mock so a test can assert calls or override behavior via
 * `overrides`. `read` throws by default (a test that reaches the read path must
 * opt in by overriding it), while the invalidators/reconcile no-op so mutation
 * and run paths run unimpeded.
 */
export function createStubHealthCheckCache(
  overrides: Partial<HealthCheckCache> = {},
): HealthCheckCache {
  return {
    read: mock(async () => {
      throw new Error("stub HealthCheckCache.read not configured");
    }),
    readBulk: mock(async () => ({})),
    readMatrix: mock(async () => ({})),
    reconcile: mock(async () => {}),
    invalidateSystem: mock(async () => {}),
    invalidateAllSystems: mock(async () => 0),
    ...overrides,
  };
}
