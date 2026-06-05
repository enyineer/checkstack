import { describe, expect, test } from "bun:test";
import { buildProjectedTool, deferredProjectionExecute } from "@checkstack/ai-backend";
import { qualifyAccessRuleId } from "@checkstack/common";
import {
  incidentContract,
  incidentAccess,
  pluginMetadata,
} from "@checkstack/incident-common";

describe("incident AI projection (incident.list)", () => {
  const tool = buildProjectedTool({
    procedure: incidentContract.listIncidents,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "listIncidents",
    name: "incident.list",
    description: "List incidents with optional status/system filters. Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
  });

  test("projects to a read-only tool named incident.list", () => {
    expect(tool.name).toBe("incident.list");
    expect(tool.effect).toBe("read");
  });

  test("carries the source procedure's own qualified access rules", () => {
    // Derived from listIncidents' own access metadata, NOT the broad
    // ai.chat.read rule.
    const expected = qualifyAccessRuleId(
      pluginMetadata,
      incidentAccess.incident.read,
    );

    expect(tool.requiredAccessRules.length).toBeGreaterThan(0);
    expect(tool.requiredAccessRules).toEqual([expected]);
    expect(tool.requiredAccessRules).not.toEqual(["ai.chat.read"]);
  });
});
