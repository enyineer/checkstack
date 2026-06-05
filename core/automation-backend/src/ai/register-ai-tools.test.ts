import { describe, expect, test } from "bun:test";
import { buildAutomationAiTools } from "./register-ai-tools";

describe("buildAutomationAiTools", () => {
  test("registers propose/update/delete with the right effects + manage rule", () => {
    const tools = buildAutomationAiTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    expect(byName.get("automation.propose")?.effect).toBe("mutate");
    expect(byName.get("automation.update")?.effect).toBe("mutate");
    // Delete is destructive, so the propose/apply gate ALWAYS confirms it.
    expect(byName.get("automation.delete")?.effect).toBe("destructive");

    // The mutating tools are gated by the manage rule.
    for (const name of [
      "automation.propose",
      "automation.update",
      "automation.delete",
    ]) {
      expect(byName.get(name)?.requiredAccessRules).toEqual([
        "automation.automation.manage",
      ]);
    }
  });

  test("registers the read-effect capability tools gated by the read rule", () => {
    const tools = buildAutomationAiTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    expect(byName.get("automation.listCapabilities")?.effect).toBe("read");
    expect(byName.get("automation.getCapabilitySchema")?.effect).toBe("read");

    for (const name of [
      "automation.listCapabilities",
      "automation.getCapabilitySchema",
    ]) {
      expect(byName.get(name)?.requiredAccessRules).toEqual([
        "automation.automation.read",
      ]);
    }
  });
});
