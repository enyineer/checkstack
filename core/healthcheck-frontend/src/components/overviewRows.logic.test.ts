import { describe, it, expect } from "bun:test";
import {
  buildOverviewRows,
  type OverviewCheckLike,
} from "./overviewRows.logic";

const ts = "2026-07-03T12:00:00.000Z";

function run(status: "healthy" | "unhealthy" | "degraded" = "healthy") {
  return { status, timestamp: ts };
}

/** A check with a fixed identity; per-env slices are supplied per test. */
function check(
  overrides: Partial<OverviewCheckLike> = {},
): OverviewCheckLike {
  return {
    configurationId: "cfg-1",
    strategyId: "http",
    configurationName: "API check",
    status: "healthy",
    paused: false,
    intervalSeconds: 60,
    recentRuns: [run()],
    ...overrides,
  };
}

const noEnvNames = new Map<string, string>();

describe("buildOverviewRows – orphan detection", () => {
  it("keeps a plain env-less check (no environments) live", () => {
    const rows = buildOverviewRows({
      checks: [check({ perEnvironment: [{ environmentId: null, status: "healthy", recentRuns: [run()] }] })],
      environmentIds: [],
      envNameById: noEnvNames,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isOrphaned).toBe(false);
    // No pill for a live single-row rollup.
    expect(rows[0].environmentId).toBeUndefined();
  });

  it("keeps an opt-out env-less check live even when the system has environments", () => {
    // Only a null slice (opt-out) => the check does not fan out => env-less is live.
    const rows = buildOverviewRows({
      checks: [check({ perEnvironment: [{ environmentId: null, status: "healthy", recentRuns: [run()] }] })],
      environmentIds: ["env-prod", "env-staging"],
      envNameById: new Map([["env-prod", "Production"]]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isOrphaned).toBe(false);
  });

  it("case 1: env-less leftover of a now-fanned-out check is orphaned", () => {
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            { environmentId: null, status: "healthy", recentRuns: [run()] },
            { environmentId: "env-prod", status: "healthy", recentRuns: [run()] },
          ],
        }),
      ],
      environmentIds: ["env-prod"],
      envNameById: new Map([["env-prod", "Production"]]),
    });
    const nullRow = rows.find((r) => r.environmentId === null);
    const prodRow = rows.find((r) => r.environmentId === "env-prod");
    expect(nullRow?.isOrphaned).toBe(true);
    expect(prodRow?.isOrphaned).toBe(false);
    expect(prodRow?.environmentName).toBe("Production");
  });

  it("treats an env DISABLED for THIS assignment as orphaned even though it is still in the system", () => {
    // env-prod is still part of the system (membership), but this assignment's
    // selector no longer includes it (environmentIds = ['env-staging']). Its
    // per-env slice - still failing from before it was disabled - must be tucked
    // under "Old checks", not counted as a live failing row.
    const rows = buildOverviewRows({
      checks: [
        check({
          environmentIds: ["env-staging"],
          perEnvironment: [
            { environmentId: "env-prod", status: "unhealthy", recentRuns: [run("unhealthy")] },
            { environmentId: "env-staging", status: "healthy", recentRuns: [run()] },
          ],
        }),
      ],
      environmentIds: ["env-prod", "env-staging"],
      envNameById: new Map([
        ["env-prod", "Production"],
        ["env-staging", "Staging"],
      ]),
    });
    const prodRow = rows.find((r) => r.environmentId === "env-prod");
    const stagingRow = rows.find((r) => r.environmentId === "env-staging");
    expect(prodRow?.isOrphaned).toBe(true);
    expect(prodRow?.state).toBe("unhealthy");
    expect(stagingRow?.isOrphaned).toBe(false);
  });

  it("case 2: all environments removed – env-less slice is live, old env slices are orphaned", () => {
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            { environmentId: null, status: "healthy", recentRuns: [run()] },
            { environmentId: "env-prod", status: "unhealthy", recentRuns: [run("unhealthy")] },
            { environmentId: "env-staging", status: "healthy", recentRuns: [run()] },
          ],
        }),
      ],
      environmentIds: [], // every environment removed from the system
      envNameById: noEnvNames,
    });
    const nullRow = rows.find((r) => r.environmentId === null);
    const prodRow = rows.find((r) => r.environmentId === "env-prod");
    const stagingRow = rows.find((r) => r.environmentId === "env-staging");
    expect(nullRow?.isOrphaned).toBe(false); // live env-less shape again
    expect(prodRow?.isOrphaned).toBe(true);
    expect(stagingRow?.isOrphaned).toBe(true);
  });

  it("case 3: a single removed environment is orphaned while the surviving one stays live", () => {
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            { environmentId: "env-prod", status: "healthy", recentRuns: [run()] },
            { environmentId: "env-legacy", status: "healthy", recentRuns: [run()] },
          ],
        }),
      ],
      environmentIds: ["env-prod"], // env-legacy was removed
      envNameById: new Map([["env-prod", "Production"]]),
    });
    const prodRow = rows.find((r) => r.environmentId === "env-prod");
    const legacyRow = rows.find((r) => r.environmentId === "env-legacy");
    expect(prodRow?.isOrphaned).toBe(false);
    expect(legacyRow?.isOrphaned).toBe(true);
  });

  it("resolves the name of an unassigned-but-still-existing environment", () => {
    // The env is no longer assigned to the system (so it's orphaned), but still
    // exists in the catalog, so its NAME must resolve from the all-envs map.
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            { environmentId: "env-prod", status: "healthy", recentRuns: [run()] },
            { environmentId: "env-staging", status: "healthy", recentRuns: [run()] },
          ],
        }),
      ],
      environmentIds: ["env-prod"], // staging unassigned but not deleted
      envNameById: new Map([
        ["env-prod", "Production"],
        ["env-staging", "Staging"],
      ]),
    });
    const staging = rows.find((r) => r.environmentId === "env-staging");
    expect(staging?.isOrphaned).toBe(true);
    expect(staging?.environmentName).toBe("Staging");
  });

  it("leaves a deleted environment's name unresolved (row renders 'Removed environment')", () => {
    // Only one slice, for an environment that no longer exists in the catalog
    // (deleted, not merely unassigned). It should be orphaned and carry the id,
    // but with no resolved name so the row can label it "Removed environment".
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [{ environmentId: "env-deleted", status: "healthy", recentRuns: [run()] }],
        }),
      ],
      environmentIds: ["env-prod"],
      envNameById: noEnvNames, // deleted env absent from the all-envs map
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isOrphaned).toBe(true);
    expect(rows[0].environmentId).toBe("env-deleted");
    expect(rows[0].environmentName).toBeUndefined();
  });

  it("keeps a lone current-environment slice live without a pill", () => {
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [{ environmentId: "env-prod", status: "healthy", recentRuns: [run()] }],
        }),
      ],
      environmentIds: ["env-prod"],
      envNameById: new Map([["env-prod", "Production"]]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isOrphaned).toBe(false);
    expect(rows[0].environmentId).toBeUndefined();
  });

  it("treats a check with no perEnvironment data as a live rollup row", () => {
    const rows = buildOverviewRows({
      checks: [check({ perEnvironment: undefined })],
      environmentIds: ["env-prod"],
      envNameById: noEnvNames,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isOrphaned).toBe(false);
  });
});

describe("buildOverviewRows – stable ordering", () => {
  it("orders checks by name regardless of the backend's array order", () => {
    const checks: OverviewCheckLike[] = [
      check({ configurationId: "c-zebra", configurationName: "Zebra" }),
      check({ configurationId: "c-alpha", configurationName: "Alpha" }),
      check({ configurationId: "c-mango", configurationName: "Mango" }),
    ];
    const forward = buildOverviewRows({
      checks,
      environmentIds: [],
      envNameById: noEnvNames,
    });
    const reversed = buildOverviewRows({
      checks: checks.toReversed(),
      environmentIds: [],
      envNameById: noEnvNames,
    });
    expect(forward.map((r) => r.name)).toEqual(["Alpha", "Mango", "Zebra"]);
    // Same output no matter what order the backend returned them in.
    expect(reversed.map((r) => r.rowKey)).toEqual(forward.map((r) => r.rowKey));
  });

  it("does not reorder when a check's health status changes", () => {
    const build = (bStatus: "healthy" | "unhealthy") =>
      buildOverviewRows({
        checks: [
          check({ configurationId: "c-a", configurationName: "A" }),
          check({
            configurationId: "c-b",
            configurationName: "B",
            status: bStatus,
            recentRuns: [run(bStatus)],
          }),
          check({ configurationId: "c-c", configurationName: "C" }),
        ],
        environmentIds: [],
        envNameById: noEnvNames,
      });
    // The middle check flipping to unhealthy must not move it in the list.
    expect(build("healthy").map((r) => r.rowKey)).toEqual(
      build("unhealthy").map((r) => r.rowKey),
    );
  });

  it("orders per-env rows with the env-less slice first, then envs by name", () => {
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            { environmentId: "env-staging", status: "healthy", recentRuns: [run()] },
            { environmentId: null, status: "healthy", recentRuns: [run()] },
            { environmentId: "env-prod", status: "healthy", recentRuns: [run()] },
          ],
        }),
      ],
      environmentIds: ["env-prod", "env-staging"],
      envNameById: new Map([
        ["env-prod", "Production"],
        ["env-staging", "Staging"],
      ]),
    });
    expect(rows.map((r) => r.environmentId)).toEqual([
      null,
      "env-prod",
      "env-staging",
    ]);
  });
});

describe("buildOverviewRows – last successful run", () => {
  const success = "2026-07-01T09:00:00.000Z";

  it("threads the check-level last successful run onto a single rollup row", () => {
    const rows = buildOverviewRows({
      checks: [
        check({
          status: "unhealthy",
          lastSuccessfulRunAt: success,
          perEnvironment: [
            { environmentId: null, status: "unhealthy", recentRuns: [run("unhealthy")] },
          ],
        }),
      ],
      environmentIds: [],
      envNameById: noEnvNames,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].lastSuccessfulRunAt).toEqual(new Date(success));
  });

  it("threads each environment's own last successful run onto per-env rows", () => {
    const prodSuccess = "2026-07-02T08:00:00.000Z";
    const rows = buildOverviewRows({
      checks: [
        check({
          status: "unhealthy",
          perEnvironment: [
            {
              environmentId: "env-prod",
              status: "unhealthy",
              lastSuccessfulRunAt: prodSuccess,
              recentRuns: [run("unhealthy")],
            },
            {
              // Never succeeded → no timestamp → row shows "Never healthy".
              environmentId: "env-staging",
              status: "unhealthy",
              recentRuns: [run("unhealthy")],
            },
          ],
        }),
      ],
      environmentIds: ["env-prod", "env-staging"],
      envNameById: new Map([
        ["env-prod", "Production"],
        ["env-staging", "Staging"],
      ]),
    });
    const prod = rows.find((r) => r.environmentId === "env-prod");
    const staging = rows.find((r) => r.environmentId === "env-staging");
    expect(prod?.lastSuccessfulRunAt).toEqual(new Date(prodSuccess));
    expect(staging?.lastSuccessfulRunAt).toBeUndefined();
  });
});

/**
 * Regression: a satellite receives NO environment information, so every result
 * it reports is written env-less. A check assigned to both the local core and a
 * satellite therefore has a live env slice (local) alongside a null slice that
 * is still being written to (the satellite). The old rule called the null slice
 * orphaned on the structural test alone, so the freshest data on the page was
 * labelled "Old checks" the instant the satellite first reported.
 */
describe("buildOverviewRows – env-less slice that is still being written", () => {
  const NOW = new Date("2026-07-03T12:00:00.000Z");
  const at = (msAgo: number) =>
    new Date(NOW.getTime() - msAgo).toISOString();

  const localAndSatellite = (satelliteLastRunMsAgo: number) =>
    check({
      intervalSeconds: 60,
      perEnvironment: [
        // Local core, fanned out to a live environment.
        {
          environmentId: "env-prod",
          status: "healthy",
          recentRuns: [{ status: "healthy", timestamp: at(30_000) }],
        },
        // The satellite's runs: env-less, because nothing tells it otherwise.
        {
          environmentId: null,
          status: "healthy",
          recentRuns: [
            { status: "healthy", timestamp: at(satelliteLastRunMsAgo) },
          ],
        },
      ],
    });

  const orphanOfNullSlice = (msAgo: number) => {
    const rows = buildOverviewRows({
      checks: [localAndSatellite(msAgo)],
      environmentIds: ["env-prod"],
      envNameById: new Map([["env-prod", "Production"]]),
      now: NOW,
    });
    const nullRow = rows.find((r) => r.environmentId === null);
    expect(nullRow).toBeDefined();
    return nullRow?.isOrphaned;
  };

  it("does NOT mark a satellite's fresh env-less slice as old", () => {
    // It reported one interval ago - it is the most current data on the page.
    expect(orphanOfNullSlice(60_000)).toBe(false);
  });

  it("still tolerates a slice that is merely slow or backing off", () => {
    // Four missed intervals on a 60s check: late, not dead.
    expect(orphanOfNullSlice(4 * 60_000)).toBe(false);
  });

  it("marks the env-less slice old once it has genuinely gone quiet", () => {
    // The case the rule was written for: a check that used to run env-less now
    // fans out per environment, so its old rollup slice stops receiving runs.
    expect(orphanOfNullSlice(24 * 60 * 60 * 1000)).toBe(true);
  });

  it("gives a fast check a floor, so seconds of silence are not 'old'", () => {
    const rows = buildOverviewRows({
      checks: [
        check({
          intervalSeconds: 10,
          perEnvironment: [
            {
              environmentId: "env-prod",
              status: "healthy",
              recentRuns: [{ status: "healthy", timestamp: at(5_000) }],
            },
            {
              environmentId: null,
              status: "healthy",
              // 2 minutes: past 5x10s, but well inside the floor.
              recentRuns: [{ status: "healthy", timestamp: at(120_000) }],
            },
          ],
        }),
      ],
      environmentIds: ["env-prod"],
      envNameById: new Map([["env-prod", "Production"]]),
      now: NOW,
    });
    expect(rows.find((r) => r.environmentId === null)?.isOrphaned).toBe(false);
  });

  it("never calls a slice that has NEVER run old - it is pending", () => {
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            {
              environmentId: "env-prod",
              status: "healthy",
              recentRuns: [{ status: "healthy", timestamp: at(30_000) }],
            },
            { environmentId: null, status: "healthy", recentRuns: [] },
          ],
        }),
      ],
      environmentIds: ["env-prod"],
      envNameById: new Map([["env-prod", "Production"]]),
      now: NOW,
    });
    expect(rows.find((r) => r.environmentId === null)?.isOrphaned).toBe(false);
  });

  it("still marks a REMOVED environment old immediately, without waiting", () => {
    // A concrete env that left the system can never run again, so it needs no
    // grace period - that verdict stays structural.
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            {
              environmentId: "env-prod",
              status: "healthy",
              recentRuns: [{ status: "healthy", timestamp: at(30_000) }],
            },
            {
              environmentId: "env-gone",
              status: "healthy",
              recentRuns: [{ status: "healthy", timestamp: at(30_000) }],
            },
          ],
        }),
      ],
      environmentIds: ["env-prod"],
      envNameById: new Map([["env-prod", "Production"]]),
      now: NOW,
    });
    expect(rows.find((r) => r.environmentId === "env-gone")?.isOrphaned).toBe(
      true,
    );
  });
});

describe("buildOverviewRows – per-location slices", () => {
  it("emits one row per (environment, source) and keeps their verdicts apart", () => {
    // The reported bug's UI half: a check that passes locally and fails from a
    // satellite showed ONE combined row, so the failing location was invisible.
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            {
              environmentId: "env-prod",
              sourceId: null,
              status: "healthy",
              recentRuns: [run()],
            },
            {
              environmentId: "env-prod",
              sourceId: "sat-eu",
              sourceLabel: "EU West",
              status: "unhealthy",
              recentRuns: [run("unhealthy")],
            },
          ],
        }),
      ],
      environmentIds: ["env-prod"],
      envNameById: new Map([["env-prod", "Production"]]),
    });

    expect(rows).toHaveLength(2);
    const local = rows.find((r) => r.sourceLabel === "Local");
    const satellite = rows.find((r) => r.sourceLabel === "EU West");
    expect(local?.state).toBe("healthy");
    expect(satellite?.state).toBe("unhealthy");
    // Distinct keys, or React collapses the two rows into one.
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(2);
  });

  it("stays silent about location when a check only runs on the core", () => {
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            { environmentId: null, sourceId: null, status: "healthy", recentRuns: [run()] },
          ],
        }),
      ],
      environmentIds: [],
      envNameById: noEnvNames,
    });

    expect(rows[0].sourceLabel).toBeUndefined();
  });

  it("names the location of a check that runs ONLY on a satellite", () => {
    // One slice, but "where" is still a real question - it is not the core.
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            {
              environmentId: null,
              sourceId: "sat-eu",
              sourceLabel: "EU West",
              status: "healthy",
              recentRuns: [run()],
            },
          ],
        }),
      ],
      environmentIds: [],
      envNameById: noEnvNames,
    });

    expect(rows[0].sourceLabel).toBe("EU West");
  });

  it("tucks a de-assigned satellite's slice under Old checks", () => {
    const rows = buildOverviewRows({
      checks: [
        check({
          perEnvironment: [
            { environmentId: null, sourceId: null, status: "healthy", recentRuns: [run()] },
            {
              environmentId: null,
              sourceId: "sat-gone",
              sourceLabel: "Retired probe",
              sourceOrphaned: true,
              status: "unhealthy",
              recentRuns: [run("unhealthy")],
            },
          ],
        }),
      ],
      environmentIds: [],
      envNameById: noEnvNames,
    });

    expect(rows.find((r) => r.sourceLabel === "Retired probe")?.isOrphaned).toBe(true);
    expect(rows.find((r) => r.sourceLabel === "Local")?.isOrphaned).toBe(false);
  });

  it("keeps a satellite's env-less slice live while the core fans out", () => {
    // Per-satellite scoping: the satellite is scoped to run once with no
    // environment while the core probes prod. Resolving "does a live env slice
    // exist" globally rather than per source would orphan the satellite's row.
    const rows = buildOverviewRows({
      checks: [
        check({
          environmentIds: ["env-prod"],
          perEnvironment: [
            {
              environmentId: "env-prod",
              sourceId: null,
              status: "healthy",
              recentRuns: [run()],
            },
            {
              environmentId: null,
              sourceId: "sat-eu",
              sourceLabel: "EU West",
              status: "healthy",
              recentRuns: [run()],
            },
          ],
        }),
      ],
      environmentIds: ["env-prod"],
      envNameById: new Map([["env-prod", "Production"]]),
    });

    expect(rows.find((r) => r.sourceLabel === "EU West")?.isOrphaned).toBe(false);
  });
});
