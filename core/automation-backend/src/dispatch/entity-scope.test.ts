import { describe, it, expect } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import {
  enrichScopeWithEntities,
  MAX_RESOLVED_SYSTEMS,
  type EntityKindResolver,
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

/** Resolver factory recording the ids each kind was asked for. */
function makeResolvers(
  data: Record<string, Record<string, Record<string, unknown>>>,
  opts?: { throwsKind?: string },
) {
  const calls: Record<string, string[][]> = {};
  const resolverFor = (kind: string): EntityKindResolver | undefined => {
    if (!(kind in data) && kind !== opts?.throwsKind) return undefined;
    return async (ids) => {
      (calls[kind] ??= []).push([...ids]);
      if (opts?.throwsKind === kind) throw new Error("resolver down");
      const out: Record<string, Record<string, unknown>> = {};
      for (const id of ids) {
        const row = data[kind]?.[id];
        if (row) out[id] = row;
      }
      return out;
    };
  };
  return { calls, resolverFor };
}

describe("enrichScopeWithEntities", () => {
  it("folds state.<kind>.<id> for resolved refs", async () => {
    const { resolverFor } = makeResolvers({
      incident: { "inc-1": { status: "open", severity: "high" } },
    });
    const scope: Record<string, unknown> = {};
    await enrichScopeWithEntities({
      scope,
      logger: noopLogger,
      refs: [{ kind: "incident", id: "inc-1" }],
      resolverFor,
    });
    const state = scope.state as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(state.incident!["inc-1"]).toEqual({ status: "open", severity: "high" });
  });

  it("groups + de-dupes ids per kind into one resolver call", async () => {
    const { calls, resolverFor } = makeResolvers({
      incident: {
        "inc-1": { status: "open" },
        "inc-2": { status: "resolved" },
      },
    });
    const scope: Record<string, unknown> = {};
    await enrichScopeWithEntities({
      scope,
      logger: noopLogger,
      refs: [
        { kind: "incident", id: "inc-1" },
        { kind: "incident", id: "inc-2" },
        { kind: "incident", id: "inc-1" }, // duplicate
      ],
      resolverFor,
    });
    expect(calls.incident).toEqual([["inc-1", "inc-2"]]);
  });

  it("projects state.health.* into scope.health (back-compat alias)", async () => {
    const { resolverFor } = makeResolvers({
      health: { "sys-1": { status: "unhealthy", in_status_for_ms: 1000 } },
    });
    const scope: Record<string, unknown> = {};
    await enrichScopeWithEntities({
      scope,
      logger: noopLogger,
      refs: [{ kind: "health", id: "sys-1" }],
      resolverFor,
    });
    const health = scope.health as { systems: Record<string, unknown> };
    expect(health.systems["sys-1"]).toEqual({
      status: "unhealthy",
      in_status_for_ms: 1000,
    });
  });

  it("does not touch scope.health when no health kind was resolved", async () => {
    const { resolverFor } = makeResolvers({
      incident: { "inc-1": { status: "open" } },
    });
    const scope: Record<string, unknown> = { health: { systems: { existing: {} } } };
    await enrichScopeWithEntities({
      scope,
      logger: noopLogger,
      refs: [{ kind: "incident", id: "inc-1" }],
      resolverFor,
    });
    // Pre-existing health namespace (set by enrichScopeWithState) untouched.
    expect((scope.health as { systems: Record<string, unknown> }).systems).toEqual({
      existing: {},
    });
  });

  it("fails open and warns when a kind has no resolver", async () => {
    const { resolverFor } = makeResolvers({ incident: {} });
    const { logger, warnings } = collectingLogger();
    const scope: Record<string, unknown> = {};
    await enrichScopeWithEntities({
      scope,
      logger,
      refs: [{ kind: "unknownkind", id: "x" }],
      resolverFor,
    });
    expect(warnings.some((w) => w.includes("no resolver for kind"))).toBe(true);
    expect(scope.state).toEqual({});
  });

  it("fails open and warns when a resolver throws", async () => {
    const { resolverFor } = makeResolvers(
      { health: {} },
      { throwsKind: "health" },
    );
    const { logger, warnings } = collectingLogger();
    const scope: Record<string, unknown> = {};
    await enrichScopeWithEntities({
      scope,
      logger,
      refs: [{ kind: "health", id: "sys-1" }],
      resolverFor,
    });
    expect(warnings.some((w) => w.includes("failed to resolve kind"))).toBe(true);
  });

  it("caps the resolved set and warns over the limit", async () => {
    const incident: Record<string, Record<string, unknown>> = {};
    const refs = Array.from({ length: MAX_RESOLVED_SYSTEMS + 5 }, (_, i) => {
      incident[`inc-${i}`] = { status: "open" };
      return { kind: "incident", id: `inc-${i}` };
    });
    const { calls, resolverFor } = makeResolvers({ incident });
    const { logger, warnings } = collectingLogger();
    const scope: Record<string, unknown> = {};
    await enrichScopeWithEntities({ scope, logger, refs, resolverFor });
    expect(calls.incident![0]!.length).toBe(MAX_RESOLVED_SYSTEMS);
    expect(warnings.some((w) => w.includes("cap reached"))).toBe(true);
  });

  it("preserves an existing scope.state namespace", async () => {
    const { resolverFor } = makeResolvers({
      incident: { "inc-1": { status: "open" } },
    });
    const scope: Record<string, unknown> = {
      state: { maintenance: { "m-1": { status: "scheduled" } } },
    };
    await enrichScopeWithEntities({
      scope,
      logger: noopLogger,
      refs: [{ kind: "incident", id: "inc-1" }],
      resolverFor,
    });
    const state = scope.state as Record<string, Record<string, unknown>>;
    expect(state.maintenance!["m-1"]).toEqual({ status: "scheduled" });
    expect(state.incident!["inc-1"]).toEqual({ status: "open" });
  });
});
