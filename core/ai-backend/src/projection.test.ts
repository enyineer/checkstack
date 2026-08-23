import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { access, definePluginMetadata, proc } from "@checkstack/common";
import type { AnyContractProcedure } from "@orpc/contract";
import { buildProjectedTool } from "./projection";

const sourcePluginMetadata = definePluginMetadata({ pluginId: "incident" });
const incidentRead = access("incident", "read", "View incidents", {
  pluginId: sourcePluginMetadata.pluginId,
});

// A realistic contract procedure with access metadata + an input schema.
const listIncidents = proc({
  operationType: "query",
  userType: "authenticated",
  access: [incidentRead],
})
  .input(z.object({ status: z.string().optional() }))
  .output(z.object({ incidents: z.array(z.unknown()) })) as AnyContractProcedure;

describe("buildProjectedTool", () => {
  test("requiredAccessRules equals the source procedure's qualified access rules", () => {
    const t = buildProjectedTool({
      procedure: listIncidents,
      sourcePluginMetadata,
      procedureKey: "listIncidents",
      description: "List incidents.",
      effect: "read",
      execute: () => Promise.resolve({}),
    });

    // qualifyAccessRuleId: `${pluginId}.${rule.id}` where rule.id = `incident.read`.
    expect(t.requiredAccessRules).toEqual(["incident.incident.read"]);
  });

  test("derives the tool name as <sourcePlugin>.<procedureKey> when no name override", () => {
    const t = buildProjectedTool({
      procedure: listIncidents,
      sourcePluginMetadata,
      procedureKey: "listIncidents",
      description: "List incidents.",
      effect: "read",
      execute: () => Promise.resolve({}),
    });
    expect(t.name).toBe("incident.listIncidents");
  });

  test("honours a name override", () => {
    const t = buildProjectedTool({
      procedure: listIncidents,
      sourcePluginMetadata,
      procedureKey: "listIncidents",
      name: "incident.list",
      description: "List incidents.",
      effect: "read",
      execute: () => Promise.resolve({}),
    });
    expect(t.name).toBe("incident.list");
  });

  test("uses the source procedure's input schema", () => {
    const t = buildProjectedTool({
      procedure: listIncidents,
      sourcePluginMetadata,
      procedureKey: "listIncidents",
      description: "List incidents.",
      effect: "read",
      execute: () => Promise.resolve({}),
    });
    // The projected input parses the same shape the procedure declared.
    expect(t.input.safeParse({ status: "open" }).success).toBe(true);
    expect(t.input.safeParse({ status: 123 }).success).toBe(false);
  });

  test("uses the source procedure's output schema", () => {
    const t = buildProjectedTool({
      procedure: listIncidents,
      sourcePluginMetadata,
      procedureKey: "listIncidents",
      description: "List incidents.",
      effect: "read",
      execute: () => Promise.resolve({}),
    });

    expect(t.output).toBeDefined();
    expect(t.output?.safeParse({ incidents: [] }).success).toBe(true);
    expect(t.output?.safeParse({ incidents: "not-an-array" }).success).toBe(
      false,
    );
  });

  test("throws when effect is omitted (never inferred from operationType)", () => {
    expect(() =>
      buildProjectedTool({
        procedure: listIncidents,
        sourcePluginMetadata,
        procedureKey: "listIncidents",
        description: "List incidents.",
        // Force the runtime guard: a JS caller could omit `effect`.
        effect: undefined as unknown as "read",
        execute: () => Promise.resolve({}),
      }),
    ).toThrow(/effect.*required/i);
  });

  test("throws when the value is not an oRPC contract procedure", () => {
    expect(() =>
      buildProjectedTool({
        procedure: {} as AnyContractProcedure,
        sourcePluginMetadata,
        procedureKey: "bogus",
        description: "Bogus.",
        effect: "read",
        execute: () => Promise.resolve({}),
      }),
    ).toThrow(/not an oRPC contract procedure/i);
  });
});
