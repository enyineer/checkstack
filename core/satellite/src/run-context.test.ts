import { describe, test, expect } from "bun:test";
import { buildRunContext } from "./run-context";
import type { SatelliteAssignment } from "@checkstack/satellite-common";

function makeAssignment(
  overrides?: Partial<SatelliteAssignment>,
): SatelliteAssignment {
  return {
    configId: "config-1",
    systemId: "system-1",
    strategyId: "http",
    config: {},
    intervalSeconds: 60,
    ...overrides,
  };
}

describe("buildRunContext", () => {
  test("uses configName and systemName when present", () => {
    const assignment = makeAssignment({
      configName: "API health",
      systemName: "Production API",
    });

    const runContext = buildRunContext({ assignment });

    expect(runContext).toEqual({
      check: { id: "config-1", name: "API health", intervalSeconds: 60 },
      system: { id: "system-1", name: "Production API" },
    });
  });

  test("falls back to ids when name fields are absent", () => {
    const assignment = makeAssignment();

    const runContext = buildRunContext({ assignment });

    expect(runContext.check.name).toBe("config-1");
    expect(runContext.check.id).toBe("config-1");
    expect(runContext.check.intervalSeconds).toBe(60);
    expect(runContext.system.name).toBe("system-1");
    expect(runContext.system.id).toBe("system-1");
  });

  test("falls back per-field when only one name is present", () => {
    const assignment = makeAssignment({ configName: "API health" });

    const runContext = buildRunContext({ assignment });

    expect(runContext.check.name).toBe("API health");
    expect(runContext.system.name).toBe("system-1");
  });
});
