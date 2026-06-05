import { describe, expect, test } from "bun:test";
import {
  buildProjectedTool,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
import { sloContract, pluginMetadata } from "@checkstack/slo-common";

// Build the projected tool with the SAME inputs the plugin exposes via
// aiToolProjectionExtensionPoint in `index.ts`, and assert the resulting tool
// carries the source procedure's contract access rules - NOT the chat
// transport's `ai.chat.read` gate.
describe("slo.listObjectives projection", () => {
  const tool = buildProjectedTool({
    procedure: sloContract.listObjectives,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "listObjectives",
    name: "slo.listObjectives",
    description:
      "List service-level objectives with their current status and error budget. Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
  });

  test("uses the overridden tool name", () => {
    expect(tool.name).toBe("slo.listObjectives");
  });

  test("is classified as a read-only effect", () => {
    expect(tool.effect).toBe("read");
  });

  test("inherits the source procedure's qualified read access rule", () => {
    // qualifyAccessRuleId: `${pluginId}.${rule.id}` where rule.id = `slo.read`.
    expect(tool.requiredAccessRules).toEqual(["slo.slo.read"]);
  });
});
