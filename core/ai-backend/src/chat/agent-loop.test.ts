import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AuthUser } from "@checkstack/backend-api";
import { createAiToolRegistry } from "../tool-registry";
import { createAiToolResolver } from "../resolver";
import type { RegisteredAiTool } from "../tool-registry";
import { disposeAgentTool, offeredTools } from "./agent-loop";

function tool(
  name: string,
  effect: RegisteredAiTool["effect"],
  rule: string,
): RegisteredAiTool {
  return {
    name,
    description: name,
    effect,
    input: z.object({}),
    requiredAccessRules: [rule],
    ...(effect === "read"
      ? {}
      : {
          dryRun: async () => ({ summary: `would ${name}`, payload: {} }),
        }),
    execute: () => Promise.resolve({ ok: true }),
  };
}

function setup() {
  const registry = createAiToolRegistry();
  const read = tool("incident_list", "read", "incident.incident.read");
  const mutate = tool("automation_propose", "mutate", "automation.automation.manage");
  const destroy = tool("incident_delete", "destructive", "incident.incident.manage");
  registry.register(read);
  registry.register(mutate);
  registry.register(destroy);
  const resolver = createAiToolResolver({ registry });
  return { registry, resolver };
}

const limited: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.read"],
};
const power: AuthUser = {
  type: "user",
  id: "u2",
  accessRules: [
    "incident.incident.read",
    "automation.automation.manage",
    "incident.incident.manage",
  ],
};

describe("agent loop tool gating (matrix #14)", () => {
  test("the loop only offers resolver-allowed tools", () => {
    const { resolver } = setup();
    const offered = offeredTools({ principal: limited, resolver }).map((t) => t.name);
    expect(offered).toEqual(["incident_list"]);
    expect(offered).not.toContain("automation_propose");
    expect(offered).not.toContain("incident_delete");
  });

  test("a model-requested tool OUTSIDE the principal's set is refused server-side", () => {
    const { resolver, registry } = setup();
    const d = disposeAgentTool({
      toolName: "automation_propose",
      principal: limited,
      resolver,
      getTool: (n) => registry.getTool(n),
    });
    expect(d.kind).toBe("refused");
  });

  test("an unknown tool name is refused", () => {
    const { resolver, registry } = setup();
    const d = disposeAgentTool({
      toolName: "does.not.exist",
      principal: power,
      resolver,
      getTool: (n) => registry.getTool(n),
    });
    expect(d.kind).toBe("refused");
  });

  test("a read tool auto-runs", () => {
    const { resolver, registry } = setup();
    const d = disposeAgentTool({
      toolName: "incident_list",
      principal: limited,
      resolver,
      getTool: (n) => registry.getTool(n),
    });
    expect(d.kind).toBe("run");
  });

  test("a mutate tool requires a confirm card (never silently mutates)", () => {
    const { resolver, registry } = setup();
    const d = disposeAgentTool({
      toolName: "automation_propose",
      principal: power,
      resolver,
      getTool: (n) => registry.getTool(n),
    });
    expect(d.kind).toBe("confirm");
  });

  test("a destructive tool requires a confirm card", () => {
    const { resolver, registry } = setup();
    const d = disposeAgentTool({
      toolName: "incident_delete",
      principal: power,
      resolver,
      getTool: (n) => registry.getTool(n),
    });
    expect(d.kind).toBe("confirm");
  });
});
