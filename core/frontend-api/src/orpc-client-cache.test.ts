import { describe, it, expect } from "bun:test";
import { getOrBuildWrappedClient } from "./orpc-query";

/**
 * The wrapped plugin client is expensive to build (it walks a plugin's entire
 * contract, allocating a hook wrapper per procedure). It MUST be shared across
 * component instances, keyed on the stable oRPC utils ROOT + contract, or a page
 * that gates many rows rebuilds the whole tree per row (a main-thread GC storm -
 * the regression these tests guard). The key is the STABLE `orpcUtils` root, NOT
 * `pluginUtils` (indexing the oRPC proxy can return a fresh object per render,
 * which would defeat the cache). We assert the sharing directly on the pure
 * cache helper, without a DOM/render harness.
 */

/** A minimal contract + matching utils: one query procedure named `getFoo`. */
function makeFixture() {
  const contract = {
    getFoo: { "~orpc": { meta: { operationType: "query" } } },
  } as Record<string, unknown>;
  const pluginUtils = {
    getFoo: { queryOptions: () => ({}) },
  } as Record<string, unknown>;
  return { contract, pluginUtils };
}

describe("getOrBuildWrappedClient", () => {
  it("returns the SAME wrapped client for the same (root, contract) even when pluginUtils is a fresh object each call", () => {
    const { contract } = makeFixture();
    const root = {}; // the stable orpcUtils root, shared across "rows"

    // Simulate the oRPC proxy handing back a NEW pluginUtils object per render.
    const a = getOrBuildWrappedClient(
      root,
      { getFoo: { queryOptions: () => ({}) } },
      contract,
      "test",
    );
    const b = getOrBuildWrappedClient(
      root,
      { getFoo: { queryOptions: () => ({}) } },
      contract,
      "test",
    );

    // Identical reference => built once and reused (a rebuild would be a new object).
    expect(b).toBe(a);
    // And it actually wrapped the procedure.
    expect(typeof (a.getFoo as Record<string, unknown>).useQuery).toBe(
      "function",
    );
  });

  it("builds a SEPARATE wrapped client for a different root (rpc client re-created)", () => {
    const first = makeFixture();
    const second = makeFixture();

    const a = getOrBuildWrappedClient(
      {},
      first.pluginUtils,
      first.contract,
      "test",
    );
    const b = getOrBuildWrappedClient(
      {},
      second.pluginUtils,
      second.contract,
      "test",
    );

    // Different roots (e.g. after the rpc client is re-created) must not collide.
    expect(b).not.toBe(a);
  });

  it("keys on the contract under a shared root", () => {
    const { pluginUtils } = makeFixture();
    const root = {};
    const contractA = {
      getFoo: { "~orpc": { meta: { operationType: "query" } } },
    } as Record<string, unknown>;
    const contractB = {
      getBar: { "~orpc": { meta: { operationType: "query" } } },
    } as Record<string, unknown>;
    // pluginUtils must expose the procedures both contracts reference.
    pluginUtils.getBar = { queryOptions: () => ({}) };

    const a1 = getOrBuildWrappedClient(root, pluginUtils, contractA, "test");
    const a2 = getOrBuildWrappedClient(root, pluginUtils, contractA, "test");
    const b = getOrBuildWrappedClient(root, pluginUtils, contractB, "test");

    expect(a2).toBe(a1); // same contract => cached
    expect(b).not.toBe(a1); // different contract => distinct wrapper
    expect(typeof (b.getBar as Record<string, unknown>).useQuery).toBe(
      "function",
    );
  });
});
