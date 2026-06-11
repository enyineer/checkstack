import { describe, test, expect } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
} from "@checkstack/status-page-backend";
import { registerMaintenanceStatusWidgets } from "./status-page-widget";

function capture(): WidgetTypeDefinition {
  let captured: WidgetTypeDefinition | undefined;
  registerMaintenanceStatusWidgets({
    registerWidgetType: (def) => {
      captured = def;
    },
  });
  if (!captured) throw new Error("no widget registered");
  return captured;
}

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

describe("maintenance widget — fail closed (S1)", () => {
  test("no bound systems resolves to empty without reading anything", async () => {
    const widget = capture();
    expect(
      await widget.resolvePublic({ config: {}, ctx: noReadCtx }),
    ).toEqual({ maintenances: [] });
  });
});
