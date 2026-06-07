import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AuthUser } from "@checkstack/backend-api";
import { createAiToolRegistry, type RegisteredAiTool } from "./tool-registry";
import { createAiToolResolver, principalSatisfiesRules } from "./resolver";

function tool(
  name: string,
  requiredAccessRules: string[],
): RegisteredAiTool {
  return {
    name,
    description: name,
    effect: "read",
    input: z.object({}),
    requiredAccessRules,
    execute: () => Promise.resolve({}),
  };
}

function userWith(accessRules: string[]): AuthUser {
  return { type: "user", id: "u1", accessRules };
}

describe("createAiToolResolver.resolveTools", () => {
  test("a principal lacking automation.manage never sees automation.propose", () => {
    const registry = createAiToolRegistry();
    registry.register(
      tool("automation_propose", ["automation.automation.manage"]),
    );
    registry.register(tool("incident_list", ["incident.incident.read"]));
    const resolver = createAiToolResolver({ registry });

    const principal = userWith(["incident.incident.read"]);
    const names = resolver.resolveTools(principal).map((t) => t.name);

    expect(names).toEqual(["incident_list"]);
    expect(names).not.toContain("automation_propose");
  });

  test("an admin (accessRules ['*']) sees all tools", () => {
    const registry = createAiToolRegistry();
    registry.register(
      tool("automation_propose", ["automation.automation.manage"]),
    );
    registry.register(tool("incident_list", ["incident.incident.read"]));
    const resolver = createAiToolResolver({ registry });

    const names = resolver
      .resolveTools(userWith(["*"]))
      .map((t) => t.name)
      .sort();

    expect(names).toEqual(["automation_propose", "incident_list"]);
  });

  test("a service principal (no access rules) sees no tools", () => {
    const registry = createAiToolRegistry();
    registry.register(tool("incident_list", ["incident.incident.read"]));
    const resolver = createAiToolResolver({ registry });

    const service: AuthUser = { type: "service", pluginId: "automation" };
    expect(resolver.resolveTools(service)).toEqual([]);
  });

  test("a tool requiring MULTIPLE rules needs ALL of them", () => {
    const registry = createAiToolRegistry();
    registry.register(
      tool("multi", ["incident.incident.read", "catalog.system.read"]),
    );
    const resolver = createAiToolResolver({ registry });

    expect(
      resolver.resolveTools(userWith(["incident.incident.read"])),
    ).toEqual([]);
    expect(
      resolver
        .resolveTools(
          userWith(["incident.incident.read", "catalog.system.read"]),
        )
        .map((t) => t.name),
    ).toEqual(["multi"]);
  });
});

describe("isAllowed mirrors autoAuthMiddleware's global-rule check", () => {
  // Replicates the EXACT predicate autoAuthMiddleware applies to global rules
  // (rpc.ts:258-260): rules.includes("*") || rules.includes(qualifiedId).
  function middlewareWouldAllow(
    rules: string[],
    requiredAccessRules: string[],
  ): boolean {
    return requiredAccessRules.every(
      (rule) => rules.includes("*") || rules.includes(rule),
    );
  }

  const ruleUniverse = ["a.read", "b.read", "c.manage"];
  const principalSets: string[][] = [
    [],
    ["*"],
    ["a.read"],
    ["a.read", "b.read"],
    ["c.manage"],
    ["a.read", "b.read", "c.manage"],
  ];
  const toolRuleSets: string[][] = [
    [],
    ["a.read"],
    ["a.read", "b.read"],
    ["c.manage"],
    ["a.read", "c.manage"],
    ruleUniverse,
  ];

  test("isAllowed == middleware decision for the full matrix", () => {
    const registry = createAiToolRegistry();
    const resolver = createAiToolResolver({ registry });

    for (const rules of principalSets) {
      for (const required of toolRuleSets) {
        const principal = userWith(rules);
        const t = tool("t", required);
        const expected = middlewareWouldAllow(rules, required);
        expect(resolver.isAllowed({ principal, tool: t })).toBe(expected);
        expect(
          principalSatisfiesRules({
            principalAccessRules: rules,
            requiredAccessRules: required,
          }),
        ).toBe(expected);
      }
    }
  });

  test("narrowing can never widen: a subset principal allows a subset of tools", () => {
    const registry = createAiToolRegistry();
    registry.register(tool("t1", ["a.read"]));
    registry.register(tool("t2", ["b.read"]));
    registry.register(tool("t3", ["c.manage"]));
    const resolver = createAiToolResolver({ registry });

    const full = userWith(["a.read", "b.read", "c.manage"]);
    const narrowed = userWith(["a.read"]); // a narrowed token: strict subset

    const fullNames = new Set(resolver.resolveTools(full).map((t) => t.name));
    const narrowedNames = resolver.resolveTools(narrowed).map((t) => t.name);

    // Every tool the narrowed principal sees is also seen by the full
    // principal — narrowing only ever removes tools.
    for (const name of narrowedNames) {
      expect(fullNames.has(name)).toBe(true);
    }
    expect(narrowedNames).toEqual(["t1"]);
  });
});
