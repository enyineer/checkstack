import { describe, expect, test } from "bun:test";
import { buildProjectedTool } from "@checkstack/ai-backend";
import { catalogContract, pluginMetadata } from "@checkstack/catalog-common";

describe("catalog read projections", () => {
  test("catalog.listSystems projects getSystems as a read tool with the system read rule", () => {
    const tool = buildProjectedTool({
      procedure: catalogContract.getSystems,
      sourcePluginMetadata: pluginMetadata,
      procedureKey: "getSystems",
      name: "catalog.listSystems",
      description:
        "List all systems (services/resources) with their ids and names. Read-only.",
      effect: "read",
      execute: () => Promise.resolve({}),
    });
    expect(tool.name).toBe("catalog.listSystems");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["catalog.system.read"]);
  });

  test("catalog.listGroups projects getGroups as a read tool with the group read rule", () => {
    const tool = buildProjectedTool({
      // unavoidable oRPC typing cast (established projection pattern):
      procedure: catalogContract.getGroups,
      sourcePluginMetadata: pluginMetadata,
      procedureKey: "getGroups",
      name: "catalog.listGroups",
      description: "List all system groups with ids and names. Read-only.",
      effect: "read",
      execute: () => Promise.resolve({}),
    });
    expect(tool.name).toBe("catalog.listGroups");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["catalog.group.read"]);
  });
});
