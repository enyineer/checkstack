import { describe, expect, test } from "bun:test";
import {
  buildProjectedTool,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
import { qualifyAccessRuleId } from "@checkstack/common";
import {
  maintenanceContract,
  maintenanceAccess,
  pluginMetadata,
} from "@checkstack/maintenance-common";

// Build the projected tools with the SAME inputs the plugin exposes via
// aiToolProjectionExtensionPoint in `index.ts`, and assert each carries the
// source procedure's OWN contract access rules - NOT the chat transport's
// `ai.chat.read` gate.
describe("maintenance AI projections", () => {
  const expectedRule = qualifyAccessRuleId(
    pluginMetadata,
    maintenanceAccess.maintenance.read,
  );

  test("maintenance.list is a read-only tool with the read rule", () => {
    const tool = buildProjectedTool({
      procedure: maintenanceContract.listMaintenances,
      sourcePluginMetadata: pluginMetadata,
      procedureKey: "listMaintenances",
      name: "maintenance.list",
      description:
        "List planned maintenance windows with optional status/system filters. Read-only.",
      effect: "read",
      execute: deferredProjectionExecute,
    });
    expect(tool.name).toBe("maintenance.list");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual([expectedRule]);
    expect(tool.requiredAccessRules).not.toEqual(["ai.chat.read"]);
  });

  test("maintenance.get is a read-only tool with the read rule", () => {
    const tool = buildProjectedTool({
      procedure: maintenanceContract.getMaintenance,
      sourcePluginMetadata: pluginMetadata,
      procedureKey: "getMaintenance",
      name: "maintenance.get",
      description:
        "Get one maintenance window with its updates and links. Read-only.",
      effect: "read",
      execute: deferredProjectionExecute,
    });
    expect(tool.name).toBe("maintenance.get");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual([expectedRule]);
    expect(tool.requiredAccessRules).not.toEqual(["ai.chat.read"]);
  });
});
