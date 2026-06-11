import { describe, test, expect } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
} from "@checkstack/status-page-backend";
import { registerIncidentStatusWidgets } from "./status-page-widget";

/** Capture the single widget the plugin registers, to exercise it directly. */
function capture(): WidgetTypeDefinition {
  let captured: WidgetTypeDefinition | undefined;
  registerIncidentStatusWidgets({
    registerWidgetType: (def) => {
      captured = def;
    },
  });
  if (!captured) throw new Error("no widget registered");
  return captured;
}

/** A context that throws on ANY read — proves the resolver touched no data. */
const noReadCtx: WidgetResolveContext = {
  rpcClient: {
    forPlugin: () => {
      throw new Error("must not read");
    },
  } as unknown as RpcClient,
  cache: () => {
    throw new Error("must not read");
  },
};

describe("incidents widget — fail closed (S1)", () => {
  test("no bound systems resolves to empty without reading anything", async () => {
    const widget = capture();
    expect(
      await widget.resolvePublic({ config: {}, ctx: noReadCtx }),
    ).toEqual({ incidents: [] });
  });

  test("binds exactly the configured systems (publish-gate input)", () => {
    expect(
      capture().boundResources({ systemIds: ["s1", "s2"], limit: 5 }),
    ).toEqual([
      { resourceType: "catalog.system", resourceId: "s1" },
      { resourceType: "catalog.system", resourceId: "s2" },
    ]);
  });
});
