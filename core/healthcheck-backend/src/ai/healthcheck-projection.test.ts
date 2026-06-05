import { describe, expect, test } from "bun:test";
import {
  buildProjectedTool,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
import { healthCheckContract, pluginMetadata } from "@checkstack/healthcheck-common";

// Build the projected tool with the SAME inputs the plugin exposes via
// aiToolProjectionExtensionPoint in `index.ts`, and assert the resulting tool
// carries the source procedure's contract access rules - NOT the chat
// transport's `ai.chat.read` gate.
describe("healthcheck.status projection", () => {
  const tool = buildProjectedTool({
    procedure: healthCheckContract.getConfigurations,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "getConfigurations",
    name: "healthcheck.status",
    description:
      "List health-check configurations and their current status. Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
  });

  test("uses the overridden tool name", () => {
    expect(tool.name).toBe("healthcheck.status");
  });

  test("is classified as a read-only effect", () => {
    expect(tool.effect).toBe("read");
  });

  test("inherits the source procedure's access rules, not the chat gate", () => {
    expect(tool.requiredAccessRules.length).toBeGreaterThan(0);
    expect(tool.requiredAccessRules).not.toEqual(["ai.chat.read"]);
  });
});
