import { describe, expect, test } from "bun:test";
import {
  buildProjectedTool,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
import {
  dependencyContract,
  pluginMetadata,
} from "@checkstack/dependency-common";

// Build the projected tool with the SAME inputs the plugin exposes via
// aiToolProjectionExtensionPoint in `index.ts`, and assert the resulting tool
// carries the source procedure's contract access rules - NOT the chat
// transport's `ai.chat.read` gate.
describe("dependency.list projection", () => {
  const tool = buildProjectedTool({
    procedure: dependencyContract.getAllDependencies,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "getAllDependencies",
    name: "dependency.list",
    description:
      "List all cross-system dependencies (the dependency graph). Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
  });

  test("uses the overridden tool name", () => {
    expect(tool.name).toBe("dependency.list");
  });

  test("is classified as a read-only effect", () => {
    expect(tool.effect).toBe("read");
  });

  test("inherits the source procedure's qualified map access rule", () => {
    // getAllDependencies (the full graph) is gated by the non-public map rule,
    // so the AI projection inherits it too: `${pluginId}.${rule.id}` where
    // rule.id = `map.read`. The full topology is map-access-only, not public.
    expect(tool.requiredAccessRules).toEqual(["dependency.map.read"]);
  });
});
