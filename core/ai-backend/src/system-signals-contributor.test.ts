import { describe, test, expect, mock } from "bun:test";
import { access } from "@checkstack/common";
import type { AuthUser } from "@checkstack/backend-api";
import type { SystemSignal, SystemSignalsMap } from "@checkstack/catalog-common";
import {
  createGatedSystemSignalsContributor,
  type SystemAccessResolver,
} from "./system-signals-contributor";

// A read rule for a fictional "demo" plugin: id "thing.read", qualified
// "demo.thing.read", qualified resource type "demo.thing".
const rule = access("thing", "read", "View things", { pluginId: "demo" });

const signal = (source: string): SystemSignal => ({
  source,
  tone: "error",
  label: "Problem",
});

const globalSignals: SystemSignalsMap = {
  sysA: [signal("demo")],
  sysB: [signal("demo")],
};

/** A resolver that returns a fixed accessible subset and records its args. */
function stubResolver(accessible: string[]): {
  resolver: SystemAccessResolver;
  calls: Array<Parameters<SystemAccessResolver["accessibleSystemIds"]>[0]>;
} {
  const calls: Array<
    Parameters<SystemAccessResolver["accessibleSystemIds"]>[0]
  > = [];
  return {
    calls,
    resolver: {
      accessibleSystemIds: async (args) => {
        calls.push(args);
        return accessible.filter((id) => args.systemIds.includes(id));
      },
    },
  };
}

const userWith = (accessRules: string[]): AuthUser => ({
  type: "user",
  id: "u1",
  accessRules,
});

describe("createGatedSystemSignalsContributor", () => {
  test("global-rule principal sees every system; resolver is not consulted", async () => {
    const read = mock(async () => globalSignals);
    const { resolver, calls } = stubResolver([]);
    const contributor = createGatedSystemSignalsContributor({
      sourceId: "demo",
      accessRule: rule,
      resolver,
      readSignals: read,
    });

    const result = await contributor.read({
      principal: userWith(["demo.thing.read"]),
    });

    expect(result.accessible).toBe(true);
    expect(Object.keys(result.signals).sort()).toEqual(["sysA", "sysB"]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0); // global access skips the team resolver
  });

  test("wildcard grant is treated as global", async () => {
    const contributor = createGatedSystemSignalsContributor({
      sourceId: "demo",
      accessRule: rule,
      resolver: stubResolver([]).resolver,
      readSignals: async () => globalSignals,
    });
    const result = await contributor.read({ principal: userWith(["*"]) });
    expect(Object.keys(result.signals).sort()).toEqual(["sysA", "sysB"]);
  });

  test("service principals are trusted (treated as global)", async () => {
    const contributor = createGatedSystemSignalsContributor({
      sourceId: "demo",
      accessRule: rule,
      resolver: stubResolver([]).resolver,
      readSignals: async () => globalSignals,
    });
    const principal: AuthUser = { type: "service", pluginId: "svc" };
    const result = await contributor.read({ principal });
    expect(result.accessible).toBe(true);
    expect(Object.keys(result.signals).sort()).toEqual(["sysA", "sysB"]);
  });

  test("a manage grant satisfies the read rule (escalation) and sees all", async () => {
    const contributor = createGatedSystemSignalsContributor({
      sourceId: "demo",
      accessRule: rule,
      resolver: stubResolver([]).resolver,
      readSignals: async () => globalSignals,
    });
    const result = await contributor.read({
      principal: userWith(["demo.thing.manage"]),
    });
    expect(Object.keys(result.signals).sort()).toEqual(["sysA", "sysB"]);
  });

  test("non-global user is filtered to team-granted systems (correct resourceType)", async () => {
    const read = mock(async () => globalSignals);
    const { resolver, calls } = stubResolver(["sysB"]);
    const contributor = createGatedSystemSignalsContributor({
      sourceId: "demo",
      accessRule: rule,
      resolver,
      readSignals: read,
    });

    const result = await contributor.read({ principal: userWith([]) });

    expect(result.accessible).toBe(true);
    expect(Object.keys(result.signals)).toEqual(["sysB"]); // sysA filtered out
    expect(read).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      userId: "u1",
      userType: "user",
      resourceType: "demo.thing", // qualifyResourceType(pluginId, resource)
      action: "read",
      hasGlobalAccess: false,
    });
    expect(calls[0].systemIds.sort()).toEqual(["sysA", "sysB"]);
  });

  test("non-global user with no team grants is reported inaccessible", async () => {
    const { resolver } = stubResolver([]); // grants nothing
    const contributor = createGatedSystemSignalsContributor({
      sourceId: "demo",
      accessRule: rule,
      resolver,
      readSignals: async () => globalSignals,
    });

    const result = await contributor.read({ principal: userWith([]) });

    expect(result).toEqual({ accessible: false, signals: {} });
  });

  test("globally-clear source: accessible with no signals, resolver not called", async () => {
    const { resolver, calls } = stubResolver([]);
    const contributor = createGatedSystemSignalsContributor({
      sourceId: "demo",
      accessRule: rule,
      resolver,
      readSignals: async () => ({}),
    });

    const result = await contributor.read({ principal: userWith([]) });

    expect(result).toEqual({ accessible: true, signals: {} });
    expect(calls).toHaveLength(0);
  });
});
