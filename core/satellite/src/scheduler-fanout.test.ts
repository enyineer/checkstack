import { describe, expect, test } from "bun:test";
import type { SatelliteAssignment } from "@checkstack/satellite-common";
import { expandRuns } from "./scheduler";

const assignment = (
  overrides: Partial<SatelliteAssignment> = {},
): SatelliteAssignment => ({
  configId: "cfg-1",
  systemId: "sys-1",
  strategyId: "http",
  config: {},
  intervalSeconds: 60,
  ...overrides,
});

describe("expandRuns", () => {
  test("runs once per environment the core assigned", () => {
    const runs = expandRuns([
      assignment({
        environments: [
          { id: "env-prod", name: "Production" },
          { id: "env-stage", name: "Staging" },
        ],
      }),
    ]);
    expect(runs.map((r) => r.environment?.id)).toEqual([
      "env-prod",
      "env-stage",
    ]);
  });

  test("an assignment with no environments runs ONCE, env-less", () => {
    // The system has none, or this satellite opted out with `[]`.
    const runs = expandRuns([assignment({ environments: [] })]);
    expect(runs).toHaveLength(1);
    expect(runs[0].environment).toBeNull();
  });

  test("an OLDER core sends no environments at all - still one env-less run", () => {
    // Version-skew safety: `environments` is optional precisely so a satellite
    // newer than its core keeps producing exactly the old behaviour.
    const runs = expandRuns([assignment()]);
    expect(runs).toHaveLength(1);
    expect(runs[0].environment).toBeNull();
  });

  test("the core has already scoped the list - the agent never re-filters", () => {
    // A satellite scoped to prod is SENT only prod. Deciding scope on the agent
    // would let a satellite widen beyond what the assignment allows.
    const runs = expandRuns([
      assignment({ environments: [{ id: "env-prod", name: "Production" }] }),
    ]);
    expect(runs.map((r) => r.environment?.id)).toEqual(["env-prod"]);
  });

  test("expands every assignment independently", () => {
    const runs = expandRuns([
      assignment({
        configId: "cfg-1",
        environments: [{ id: "env-a", name: "A" }],
      }),
      assignment({
        configId: "cfg-2",
        environments: [
          { id: "env-a", name: "A" },
          { id: "env-b", name: "B" },
        ],
      }),
    ]);
    expect(
      runs.map((r) => `${r.assignment.configId}:${r.environment?.id}`),
    ).toEqual(["cfg-1:env-a", "cfg-2:env-a", "cfg-2:env-b"]);
  });
});
