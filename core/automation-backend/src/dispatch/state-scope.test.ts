import { describe, it, expect } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import {
  enrichScopeWithState,
  MAX_RESOLVED_SYSTEMS,
  type ScopeHealthNamespace,
} from "./state-scope";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function collectingLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const logger = {
    debug: () => {},
    info: () => {},
    warn: (msg: string) => warnings.push(msg),
    error: () => {},
  } as unknown as Logger;
  return { logger, warnings };
}

function makeState(over: Record<string, unknown> = {}) {
  return {
    status: "unhealthy",
    inStatusSince: new Date("2026-05-30T11:00:00.000Z"),
    inStatusForMs: 3_600_000,
    latencyMs: 42,
    avgLatencyMs: 50,
    p95LatencyMs: 120,
    successRate: 0.9,
    lastRunAt: new Date("2026-05-30T11:59:00.000Z"),
    inMaintenance: false,
    evaluatedAt: new Date("2026-05-30T12:00:00.000Z"),
    ...over,
  };
}

/** Minimal mock health client recording the systemIds it was asked for. */
function makeClient(
  states: Record<string, ReturnType<typeof makeState>>,
  opts?: { throws?: boolean },
) {
  const calls: string[][] = [];
  return {
    calls,
    client: {
      getBulkHealthState: async ({ systemIds }: { systemIds: string[] }) => {
        calls.push(systemIds);
        if (opts?.throws) throw new Error("provider down");
        const out: Record<string, unknown> = {};
        for (const id of systemIds) if (states[id]) out[id] = states[id];
        return { states: out };
      },
    } as never,
  };
}

function getHealth(scope: Record<string, unknown>): ScopeHealthNamespace {
  return scope.health as ScopeHealthNamespace;
}

describe("enrichScopeWithState", () => {
  it("folds the context system under health.system and health.systems[id]", async () => {
    const { client, calls } = makeClient({ "sys-1": makeState() });
    const scope: Record<string, unknown> = {};
    await enrichScopeWithState({
      scope,
      client,
      logger: noopLogger,
      contextKey: "sys-1",
    });
    expect(calls).toEqual([["sys-1"]]);
    const health = getHealth(scope);
    expect(health.system?.status).toBe("unhealthy");
    expect(health.system?.in_status_for_ms).toBe(3_600_000);
    expect(health.systems["sys-1"]?.status).toBe("unhealthy");
  });

  it("converts Date fields to ISO strings (for duration filters)", async () => {
    const { client } = makeClient({ "sys-1": makeState() });
    const scope: Record<string, unknown> = {};
    await enrichScopeWithState({
      scope,
      client,
      logger: noopLogger,
      contextKey: "sys-1",
    });
    const health = getHealth(scope);
    expect(health.system?.in_status_since).toBe("2026-05-30T11:00:00.000Z");
    expect(health.system?.last_run_at).toBe("2026-05-30T11:59:00.000Z");
    expect(health.system?.evaluated_at).toBe("2026-05-30T12:00:00.000Z");
  });

  it("preserves null inStatusSince as null", async () => {
    const { client } = makeClient({
      "sys-1": makeState({ inStatusSince: null }),
    });
    const scope: Record<string, unknown> = {};
    await enrichScopeWithState({
      scope,
      client,
      logger: noopLogger,
      contextKey: "sys-1",
    });
    expect(getHealth(scope).system?.in_status_since).toBeNull();
  });

  it("resolves uses_state ids in addition to the context system, de-duped", async () => {
    const { client, calls } = makeClient({
      "sys-1": makeState(),
      "sys-2": makeState({ status: "degraded" }),
    });
    const scope: Record<string, unknown> = {};
    await enrichScopeWithState({
      scope,
      client,
      logger: noopLogger,
      contextKey: "sys-1",
      usesState: ["sys-2", "sys-1"], // sys-1 duplicate dropped
    });
    expect(calls).toEqual([["sys-1", "sys-2"]]);
    const health = getHealth(scope);
    expect(health.systems["sys-2"]?.status).toBe("degraded");
    // system still points at the context system
    expect(health.system?.status).toBe("unhealthy");
  });

  it("exposes an empty namespace when there is no context key and no uses_state", async () => {
    const { client, calls } = makeClient({});
    const scope: Record<string, unknown> = {};
    await enrichScopeWithState({
      scope,
      client,
      logger: noopLogger,
      contextKey: null,
    });
    expect(calls).toEqual([]); // no query issued
    expect(getHealth(scope)).toEqual({ systems: {} });
  });

  it("exposes an empty namespace when no client is wired (fail-open)", async () => {
    const scope: Record<string, unknown> = {};
    await enrichScopeWithState({
      scope,
      client: undefined,
      logger: noopLogger,
      contextKey: "sys-1",
    });
    expect(getHealth(scope)).toEqual({ systems: {} });
  });

  it("fails open to an empty namespace and warns on provider error", async () => {
    const { client } = makeClient({}, { throws: true });
    const { logger, warnings } = collectingLogger();
    const scope: Record<string, unknown> = {};
    await enrichScopeWithState({
      scope,
      client,
      logger,
      contextKey: "sys-1",
    });
    expect(getHealth(scope)).toEqual({ systems: {} });
    expect(warnings.some((w) => w.includes("failed to resolve"))).toBe(true);
  });

  it("caps the resolved set and warns when over the limit", async () => {
    const big = Array.from(
      { length: MAX_RESOLVED_SYSTEMS + 5 },
      (_, i) => `sys-${i}`,
    );
    const { client, calls } = makeClient({});
    const { logger, warnings } = collectingLogger();
    const scope: Record<string, unknown> = {};
    await enrichScopeWithState({
      scope,
      client,
      logger,
      contextKey: big[0]!,
      usesState: big.slice(1),
    });
    expect(calls[0]?.length).toBe(MAX_RESOLVED_SYSTEMS);
    expect(warnings.some((w) => w.includes("cap reached"))).toBe(true);
  });

  it("leaves health.system undefined when the context system has no state", async () => {
    // client returns nothing for the requested id
    const { client } = makeClient({});
    const scope: Record<string, unknown> = {};
    await enrichScopeWithState({
      scope,
      client,
      logger: noopLogger,
      contextKey: "sys-1",
    });
    const health = getHealth(scope);
    expect(health.system).toBeUndefined();
    expect(health.systems).toEqual({});
  });
});
