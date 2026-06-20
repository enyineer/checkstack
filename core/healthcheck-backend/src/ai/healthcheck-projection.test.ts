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

// The per-system projection is how the assistant maps a check to a system:
// `healthcheck.status` lists every check globally with no system attribution, so
// it must call this with a `systemId` (resolved via catalog.listSystems) to know
// which checks are assigned to that system. Gated by the system-scoped
// `configuration.read` rule, NOT the chat transport gate.
describe("healthcheck.listSystemChecks projection", () => {
  const tool = buildProjectedTool({
    procedure: healthCheckContract.getSystemConfigurations,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "getSystemConfigurations",
    name: "healthcheck.listSystemChecks",
    description: "List the health checks assigned to a system. Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
  });

  test("uses the overridden tool name", () => {
    expect(tool.name).toBe("healthcheck.listSystemChecks");
  });

  test("is classified as a read-only effect", () => {
    expect(tool.effect).toBe("read");
  });

  test("exposes the systemId input to the model", () => {
    const inputShape = tool.input as { shape?: Record<string, unknown> };
    expect(inputShape.shape).toBeDefined();
    expect(inputShape.shape?.["systemId"]).toBeDefined();
  });

  test("inherits the source procedure's access rules, not the chat gate", () => {
    expect(tool.requiredAccessRules.length).toBeGreaterThan(0);
    expect(tool.requiredAccessRules).not.toEqual(["ai.chat.read"]);
  });
});

// The run-history projection lets the assistant answer timeline / root-cause
// questions ("what issues did system X have between T1 and T2"). It must expose
// the filter inputs (systemId, date window, statusFilter) and be gated by the
// public, default-on `healthcheck.status` VIEW rule (the same one the dashboard
// history view uses), so it needs no special grant.
describe("healthcheck.runHistory projection", () => {
  const tool = buildProjectedTool({
    procedure: healthCheckContract.getHistory,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "getHistory",
    name: "healthcheck.runHistory",
    description: "List historical health-check runs. Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
  });

  test("uses the overridden tool name", () => {
    expect(tool.name).toBe("healthcheck.runHistory");
  });

  test("is classified as a read-only effect", () => {
    expect(tool.effect).toBe("read");
  });

  test("exposes the timespan/system/status filter inputs to the model", () => {
    const inputShape = tool.input as { shape?: Record<string, unknown> };
    expect(inputShape.shape).toBeDefined();
    for (const field of ["systemId", "startDate", "endDate", "statusFilter"]) {
      expect(inputShape.shape?.[field]).toBeDefined();
    }
  });

  test("is gated by the public healthcheck.status view rule, not the chat gate", () => {
    expect(tool.requiredAccessRules).toEqual(["healthcheck.healthcheck.status.read"]);
  });
});
