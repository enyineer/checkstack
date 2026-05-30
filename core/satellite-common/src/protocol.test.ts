import { describe, test, expect } from "bun:test";
import { SatelliteAssignmentSchema } from "./protocol";

describe("SatelliteAssignmentSchema", () => {
  const base = {
    configId: "config-1",
    systemId: "system-1",
    strategyId: "http",
    config: {},
    intervalSeconds: 60,
  };

  test("parses an assignment WITH configName and systemName", () => {
    const parsed = SatelliteAssignmentSchema.parse({
      ...base,
      configName: "API health",
      systemName: "Production API",
    });

    expect(parsed.configName).toBe("API health");
    expect(parsed.systemName).toBe("Production API");
  });

  test("parses an assignment WITHOUT configName and systemName (optional)", () => {
    const parsed = SatelliteAssignmentSchema.parse(base);

    expect(parsed.configName).toBeUndefined();
    expect(parsed.systemName).toBeUndefined();
  });
});
