import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { access, definePluginMetadata, proc } from "@checkstack/common";
import { AiToolEffectSchema } from "@checkstack/ai-common";
import type { AnyContractProcedure } from "@orpc/contract";
import { createAiToolRegistry } from "./tool-registry";
import { createRegistryExtensionPoints } from "./registry-wiring";
import type { RegisteredAiTool } from "./tool-registry";

const sourcePluginMetadata = definePluginMetadata({ pluginId: "incident" });
const incidentRead = access("incident", "read", "View incidents");
const listIncidents = proc({
  operationType: "query",
  userType: "authenticated",
  access: [incidentRead],
}).input(z.object({ status: z.string().optional() })) as AnyContractProcedure;

function handAuthoredTool(): RegisteredAiTool {
  return {
    // Unqualified name — the extension point must qualify it with the plugin id.
    name: "propose",
    description: "Propose an automation from natural language.",
    effect: "mutate",
    input: z.object({ prompt: z.string() }),
    requiredAccessRules: ["automation.automation.manage"],
    execute: () => Promise.resolve({}),
  };
}

describe("createRegistryExtensionPoints (end-to-end registration)", () => {
  test("registerTool qualifies an unqualified name with the plugin id", () => {
    const registry = createAiToolRegistry();
    const { toolExtensionPoint } = createRegistryExtensionPoints({ registry });

    toolExtensionPoint.registerTool(
      handAuthoredTool(),
      definePluginMetadata({ pluginId: "automation" }),
    );

    expect(registry.hasTool("automation.propose")).toBe(true);
    expect(registry.getTool("automation.propose")?.effect).toBe("mutate");
  });

  test("registerTool leaves an already-qualified name unchanged", () => {
    const registry = createAiToolRegistry();
    const { toolExtensionPoint } = createRegistryExtensionPoints({ registry });

    toolExtensionPoint.registerTool(
      { ...handAuthoredTool(), name: "automation.propose" },
      definePluginMetadata({ pluginId: "different" }),
    );

    expect(registry.hasTool("automation.propose")).toBe(true);
    expect(registry.hasTool("different.automation.propose")).toBe(false);
  });

  test("expose builds and registers a projected tool from a contract procedure", () => {
    const registry = createAiToolRegistry();
    const { projectionExtensionPoint } = createRegistryExtensionPoints({
      registry,
    });

    projectionExtensionPoint.expose({
      procedure: listIncidents,
      sourcePluginMetadata,
      procedureKey: "listIncidents",
      name: "incident.list",
      description: "List incidents.",
      effect: "read",
      execute: () => Promise.resolve({}),
    });

    const tool = registry.getTool("incident.list");
    expect(tool).toBeDefined();
    // Access rules read verbatim from the source procedure, qualified.
    expect(tool?.requiredAccessRules).toEqual(["incident.incident.read"]);
    expect(tool?.effect).toBe("read");
  });

  test("both paths populate the SAME registry (one spine, two paths)", () => {
    const registry = createAiToolRegistry();
    const { toolExtensionPoint, projectionExtensionPoint } =
      createRegistryExtensionPoints({ registry });

    toolExtensionPoint.registerTool(
      handAuthoredTool(),
      definePluginMetadata({ pluginId: "automation" }),
    );
    projectionExtensionPoint.expose({
      procedure: listIncidents,
      sourcePluginMetadata,
      procedureKey: "listIncidents",
      name: "incident.list",
      description: "List incidents.",
      effect: "read",
      execute: () => Promise.resolve({}),
    });

    expect(registry.getTools().map((t) => t.name).sort()).toEqual([
      "automation.propose",
      "incident.list",
    ]);
  });

  // §4.2 belt-and-suspenders: every registered tool carries a VALID effect.
  // This is already guaranteed by the `AiToolEffect` type at compile time, but
  // the runtime assertion documents the invariant the permission-mode gating
  // keys on - an effect outside `read | mutate | destructive` would slip the
  // 3-tier disposition logic.
  test("every registered tool has a valid effect", () => {
    const registry = createAiToolRegistry();
    const { toolExtensionPoint, projectionExtensionPoint } =
      createRegistryExtensionPoints({ registry });
    toolExtensionPoint.registerTool(
      handAuthoredTool(),
      definePluginMetadata({ pluginId: "automation" }),
    );
    projectionExtensionPoint.expose({
      procedure: listIncidents,
      sourcePluginMetadata,
      procedureKey: "listIncidents",
      name: "incident.list",
      description: "List incidents.",
      effect: "read",
      execute: () => Promise.resolve({}),
    });
    for (const tool of registry.getTools()) {
      expect(AiToolEffectSchema.safeParse(tool.effect).success).toBe(true);
    }
  });
});
