import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { SourceBinding } from "@checkstack/telemetry-common";
import {
  createTelemetrySourceRegistry,
  defineTelemetrySourceType,
  type TelemetrySourceRegistry,
} from "../extension-points";
import { invokePullHealthHooks } from "./pull-capability";

interface HookCalls {
  failure: { consecutiveFailures: number; error: string; sourceName: string }[];
  recovery: { sourceName: string }[];
}

/** A satellite pull type whose health hooks record their invocations. */
function registryWithHooks(
  hookCalls: HookCalls,
  opts: { onRunFailureThrows?: boolean } = {},
): TelemetrySourceRegistry {
  const registry = createTelemetrySourceRegistry();
  registry.register(
    defineTelemetrySourceType({
      id: "edge",
      displayName: "Edge",
      description: "",
      signals: ["logs"],
      configSchema: z.object({ url: z.string() }),
      supportsSatellite: true,
      pull: {
        defaultIntervalSeconds: 60,
        minIntervalSeconds: 30,
        execute: async () => {},
        onRunFailure: async ({ consecutiveFailures, error, sourceName }) => {
          hookCalls.failure.push({ consecutiveFailures, error, sourceName });
          if (opts.onRunFailureThrows) throw new Error("hook boom");
        },
        onRunRecovery: async ({ sourceName }) => {
          hookCalls.recovery.push({ sourceName });
        },
      },
    }),
    { pluginId: "p" },
  );
  return registry;
}

const bindings: SourceBinding[] = [{ signal: "logs", streamId: "stream-1" }];
const row = {
  id: "src-1",
  sourceTypeId: "p.edge",
  name: "Edge prod",
  config: { url: "https://a" },
  bindings,
};

describe("invokePullHealthHooks (satellite status path)", () => {
  it("invokes onRunFailure with the just-stored count when the count rose", async () => {
    const hookCalls: HookCalls = { failure: [], recovery: [] };
    await invokePullHealthHooks({
      sourceRegistry: registryWithHooks(hookCalls),
      logger: createMockLogger(),
      row,
      previousFailures: 2,
      nextFailures: 3,
      error: "connection refused",
    });
    expect(hookCalls.failure).toEqual([
      { consecutiveFailures: 3, error: "connection refused", sourceName: "Edge prod" },
    ]);
    expect(hookCalls.recovery).toEqual([]);
  });

  it("invokes onRunRecovery exactly once on the first success after failures", async () => {
    const hookCalls: HookCalls = { failure: [], recovery: [] };
    await invokePullHealthHooks({
      sourceRegistry: registryWithHooks(hookCalls),
      logger: createMockLogger(),
      row,
      previousFailures: 4,
      nextFailures: 0,
      error: null,
    });
    expect(hookCalls.recovery).toEqual([{ sourceName: "Edge prod" }]);
    expect(hookCalls.failure).toEqual([]);
  });

  it("fires nothing on a steady healthy report (0 -> 0)", async () => {
    const hookCalls: HookCalls = { failure: [], recovery: [] };
    await invokePullHealthHooks({
      sourceRegistry: registryWithHooks(hookCalls),
      logger: createMockLogger(),
      row,
      previousFailures: 0,
      nextFailures: 0,
      error: null,
    });
    expect(hookCalls.failure).toEqual([]);
    expect(hookCalls.recovery).toEqual([]);
  });

  it("a throwing hook never propagates", async () => {
    const hookCalls: HookCalls = { failure: [], recovery: [] };
    await invokePullHealthHooks({
      sourceRegistry: registryWithHooks(hookCalls, { onRunFailureThrows: true }),
      logger: createMockLogger(),
      row,
      previousFailures: 0,
      nextFailures: 1,
      error: "boom",
    });
    expect(hookCalls.failure).toHaveLength(1);
  });
});
