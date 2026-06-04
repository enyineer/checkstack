import { describe, expect, test } from "bun:test";
import {
  buildProjectedTool,
  deferredProjectionExecute,
} from "@checkstack/ai-backend";
import { anomalyContract, pluginMetadata } from "@checkstack/anomaly-common";

describe("anomaly AI projection (anomaly.explain)", () => {
  test("projects getAnomalies as a read-only tool with the source procedure's access rules", () => {
    const tool = buildProjectedTool({
      procedure: anomalyContract.getAnomalies,
      sourcePluginMetadata: pluginMetadata,
      procedureKey: "getAnomalies",
      name: "anomaly.explain",
      description:
        "List detected anomalies (statistical sigma/drift) for context. Read-only.",
      effect: "read",
      execute: deferredProjectionExecute,
    });

    expect(tool.name).toBe("anomaly.explain");
    expect(tool.effect).toBe("read");

    // The projection inherits the source procedure's gating — it must NOT
    // collapse to the generic chat scope.
    expect(tool.requiredAccessRules.length).toBeGreaterThan(0);
    expect(tool.requiredAccessRules).not.toEqual(["ai.chat.read"]);
  });
});
