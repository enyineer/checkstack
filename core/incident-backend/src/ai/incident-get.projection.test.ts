import { describe, expect, test } from "bun:test";
import {
  buildProjectedTool,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
import { qualifyAccessRuleId } from "@checkstack/common";
import {
  incidentContract,
  incidentAccess,
  pluginMetadata,
} from "@checkstack/incident-common";

// Build the projected tool with the SAME inputs the plugin exposes via
// aiToolProjectionExtensionPoint in `index.ts`, and assert the resulting tool
// carries the source procedure's contract access rules - NOT the chat
// transport's `ai.chat.read` gate.
describe("incident.get projection", () => {
  const tool = buildProjectedTool({
    procedure: incidentContract.getIncident,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "getIncident",
    name: "incident.get",
    description:
      "Get one incident with its full timeline (updates) and links. Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
  });

  test("uses the overridden tool name", () => {
    expect(tool.name).toBe("incident.get");
  });

  test("is classified as a read-only effect", () => {
    expect(tool.effect).toBe("read");
  });

  test("inherits the source procedure's read rule, not the chat gate", () => {
    expect(tool.requiredAccessRules).toEqual([
      qualifyAccessRuleId(pluginMetadata, incidentAccess.incident.read),
    ]);
    expect(tool.requiredAccessRules).not.toEqual(["ai.chat.read"]);
  });
});
