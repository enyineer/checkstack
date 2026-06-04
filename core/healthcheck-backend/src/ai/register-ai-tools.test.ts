import { describe, expect, test } from "bun:test";
import { buildHealthcheckAiTools } from "./register-ai-tools";

describe("buildHealthcheckAiTools", () => {
  test("registers propose/update/delete with the right effects + manage rule", () => {
    const tools = buildHealthcheckAiTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    expect(byName.get("healthcheck.propose")?.effect).toBe("mutate");
    expect(byName.get("healthcheck.update")?.effect).toBe("mutate");
    // Delete is destructive, so the propose/apply gate ALWAYS confirms it.
    expect(byName.get("healthcheck.delete")?.effect).toBe("destructive");

    // The mutating tools are gated by the manage rule.
    for (const name of [
      "healthcheck.propose",
      "healthcheck.update",
      "healthcheck.delete",
    ] as const) {
      expect(byName.get(name)?.requiredAccessRules).toEqual([
        "healthcheck.healthcheck.manage",
      ]);
    }
  });

  test("registers the read-only capability tools gated by the read rule", () => {
    const tools = buildHealthcheckAiTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    for (const name of [
      "healthcheck.listCapabilities",
      "healthcheck.getCapabilitySchema",
    ] as const) {
      const tool = byName.get(name);
      expect(tool?.effect).toBe("read");
      expect(tool?.requiredAccessRules).toEqual([
        "healthcheck.healthcheck.read",
      ]);
    }
  });
});
