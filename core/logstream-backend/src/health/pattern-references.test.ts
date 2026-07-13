import { describe, it, expect } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import type { CachedScope } from "@checkstack/cache-utils";
import { createReferencedPatternResolver } from "./pattern-references";

/**
 * The referenced-pattern resolver drives BOTH retention (spare a referenced
 * quiet pattern) and Drain protection (pin a referenced cluster). It must
 * collect `patternId`s from `pattern-occurrence` AND `pattern-metric`
 * collectors, only for enabled `logstream.logstream` configs bound to the
 * queried stream. These pure tests mock the cross-plugin RPC + cache seam.
 */

/** A pass-through cache: every `wrap` just runs the loader (no memoization). */
const passThroughCache = {
  wrap: <T>(_key: string, loader: () => Promise<T>) => loader(),
} as unknown as CachedScope;

interface FakeCollector {
  collectorId: string;
  config: Record<string, unknown>;
}
interface FakeConfiguration {
  strategyId: string;
  config: Record<string, unknown>;
  collectors?: FakeCollector[];
}

/** Build an RpcClient whose HealthCheckApi.getConfigurations returns `configs`. */
function fakeRpcClient(configs: FakeConfiguration[]): RpcClient {
  return {
    forPlugin: () => ({
      getConfigurations: async () => ({ configurations: configs }),
    }),
    // Only `forPlugin(...).getConfigurations()` is exercised; the rest of the
    // RpcClient surface is unused here.
  } as unknown as RpcClient;
}

const STREAM = "stream-1";

describe("createReferencedPatternResolver", () => {
  it("collects patternIds from pattern-occurrence and pattern-metric collectors", async () => {
    const resolve = createReferencedPatternResolver({
      rpcClient: fakeRpcClient([
        {
          strategyId: "logstream.logstream",
          config: { streamId: STREAM },
          collectors: [
            { collectorId: "logstream.pattern-occurrence", config: { patternId: "p-occ" } },
            { collectorId: "logstream.pattern-metric", config: { patternId: "p-met", variableIndex: 0 } },
            { collectorId: "logstream.window-metrics", config: {} },
          ],
        },
      ]),
      cache: passThroughCache,
    });
    const ids = await resolve(STREAM);
    expect([...ids].sort()).toEqual(["p-met", "p-occ"]);
  });

  it("ignores configs for another stream or a non-logstream strategy", async () => {
    const resolve = createReferencedPatternResolver({
      rpcClient: fakeRpcClient([
        {
          strategyId: "logstream.logstream",
          config: { streamId: "other-stream" },
          collectors: [
            { collectorId: "logstream.pattern-occurrence", config: { patternId: "p-other" } },
          ],
        },
        {
          strategyId: "http.http",
          config: { streamId: STREAM },
          collectors: [
            { collectorId: "logstream.pattern-occurrence", config: { patternId: "p-wrong-strategy" } },
          ],
        },
      ]),
      cache: passThroughCache,
    });
    expect(await resolve(STREAM)).toEqual([]);
  });

  it("dedupes a patternId referenced by multiple collectors/configs", async () => {
    const resolve = createReferencedPatternResolver({
      rpcClient: fakeRpcClient([
        {
          strategyId: "logstream.logstream",
          config: { streamId: STREAM },
          collectors: [
            { collectorId: "logstream.pattern-occurrence", config: { patternId: "dup" } },
            { collectorId: "logstream.pattern-metric", config: { patternId: "dup", variableIndex: 1 } },
          ],
        },
        {
          strategyId: "logstream.logstream",
          config: { streamId: STREAM },
          collectors: [
            { collectorId: "logstream.pattern-occurrence", config: { patternId: "dup" } },
          ],
        },
      ]),
      cache: passThroughCache,
    });
    expect(await resolve(STREAM)).toEqual(["dup"]);
  });

  it("skips a collector whose patternId is missing or blank", async () => {
    const resolve = createReferencedPatternResolver({
      rpcClient: fakeRpcClient([
        {
          strategyId: "logstream.logstream",
          config: { streamId: STREAM },
          collectors: [
            { collectorId: "logstream.pattern-occurrence", config: {} },
            { collectorId: "logstream.pattern-metric", config: { patternId: "" } },
            { collectorId: "logstream.pattern-occurrence", config: { patternId: "kept" } },
          ],
        },
      ]),
      cache: passThroughCache,
    });
    expect(await resolve(STREAM)).toEqual(["kept"]);
  });
});
