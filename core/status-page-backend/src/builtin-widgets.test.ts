import { describe, test, expect } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import { createWidgetTypeRegistry } from "./widget-registry";
import type { WidgetResolveContext } from "./widget-registry";
import { registerBuiltinWidgets } from "./builtin-widgets";

/** A context that THROWS on any read — proves a resolver touched no data. */
const noReadCtx: WidgetResolveContext = {
  rpcClient: {
    forPlugin: () => {
      throw new Error("resolver must not read for an empty binding");
    },
  } as unknown as RpcClient,
  systemNames: async () => {
    throw new Error("must not read");
  },
  groups: async () => {
    throw new Error("must not read");
  },
};

function builtins() {
  const registry = createWidgetTypeRegistry();
  registerBuiltinWidgets(registry);
  return registry;
}

describe("builtin widgets — fail closed (S1)", () => {
  test("incidents with NO bound systems resolves to empty without reading", async () => {
    const widget = builtins().get("statuspage.incidents");
    expect(widget).toBeDefined();
    const data = await widget!.resolvePublic({ config: {}, ctx: noReadCtx });
    expect(data).toEqual({ incidents: [] });
  });

  test("maintenance with NO bound systems resolves to empty without reading", async () => {
    const widget = builtins().get("statuspage.maintenance");
    const data = await widget!.resolvePublic({ config: {}, ctx: noReadCtx });
    expect(data).toEqual({ maintenances: [] });
  });

  test("boundResources reflects exactly the configured systems (gate input)", () => {
    const widget = builtins().get("statuspage.incidents");
    expect(
      widget!.boundResources({ systemIds: ["s1", "s2"], limit: 5 }),
    ).toEqual([
      { resourceType: "catalog.system", resourceId: "s1" },
      { resourceType: "catalog.system", resourceId: "s2" },
    ]);
  });

  test("registry exposes all built-in widget types", () => {
    const ids = builtins()
      .list()
      .map((w) => w.qualifiedId)
      .sort();
    expect(ids).toContain("statuspage.banner");
    expect(ids).toContain("statuspage.systemHealth");
    expect(ids).toContain("statuspage.incidents");
    expect(ids).toContain("statuspage.groupStatus");
    expect(ids).toContain("statuspage.links");
  });
});
