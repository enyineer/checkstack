import { describe, test, expect } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import type { SystemSignal, SystemSignalsMap } from "@checkstack/catalog-common";
import type {
  SystemSignalsContributor,
  SystemSignalsContribution,
} from "../extension-points";
import {
  mergeSystemSignalsMaps,
  collectSystemSignals,
  toSystemIssuesOutput,
  type SystemSignalsCollection,
} from "./system-issues";

const signal = (over: Partial<SystemSignal> = {}): SystemSignal => ({
  source: "incident",
  tone: "error",
  label: "Critical incident",
  ...over,
});

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["catalog.system.read"],
};

/** A contributor that is accessible and returns `signals`. */
const ok = (
  sourceId: string,
  signals: SystemSignalsMap,
): SystemSignalsContributor => ({
  sourceId,
  read: async (): Promise<SystemSignalsContribution> => ({
    accessible: true,
    signals,
  }),
});

/** A contributor the principal cannot access. */
const denied = (sourceId: string): SystemSignalsContributor => ({
  sourceId,
  read: async (): Promise<SystemSignalsContribution> => ({
    accessible: false,
    signals: {},
  }),
});

/** A contributor that throws while reading. */
const throwing = (sourceId: string): SystemSignalsContributor => ({
  sourceId,
  read: async (): Promise<SystemSignalsContribution> => {
    throw new Error(`${sourceId} exploded`);
  },
});

const emptyCollection = (
  merged: SystemSignalsMap,
): SystemSignalsCollection => ({
  merged,
  checkedSources: [],
  inaccessibleSources: [],
  failedSources: [],
});

describe("mergeSystemSignalsMaps", () => {
  test("merges two maps by systemId, concatenating signal arrays", () => {
    const a: SystemSignalsMap = {
      sysA: [signal({ source: "incident", label: "Incident" })],
      sysB: [signal({ source: "incident", label: "B incident" })],
    };
    const b: SystemSignalsMap = {
      sysA: [signal({ source: "slo", tone: "warn", label: "SLO at risk" })],
      sysC: [signal({ source: "anomaly", tone: "warn", label: "Anomaly" })],
    };

    const merged = mergeSystemSignalsMaps([a, b]);

    expect(Object.keys(merged).sort()).toEqual(["sysA", "sysB", "sysC"]);
    // sysA gets both sources concatenated.
    expect(merged.sysA).toHaveLength(2);
    expect(merged.sysA.map((s) => s.source)).toEqual(["incident", "slo"]);
    expect(merged.sysB).toHaveLength(1);
    expect(merged.sysC).toHaveLength(1);
  });

  test("does not mutate the input maps", () => {
    const a: SystemSignalsMap = { sysA: [signal()] };
    const b: SystemSignalsMap = { sysA: [signal({ source: "slo" })] };

    mergeSystemSignalsMaps([a, b]);

    expect(a.sysA).toHaveLength(1);
    expect(b.sysA).toHaveLength(1);
  });

  test("skips empty signal arrays", () => {
    const merged = mergeSystemSignalsMaps([{ sysA: [] }, { sysB: [signal()] }]);
    expect(Object.keys(merged)).toEqual(["sysB"]);
  });
});

describe("collectSystemSignals", () => {
  test("merges signals from accessible contributors and lists them as checked", async () => {
    const contributors = [
      ok("incident", { sysA: [signal({ source: "incident" })] }),
      ok("slo", {
        sysA: [signal({ source: "slo", tone: "warn", label: "SLO" })],
        sysB: [signal({ source: "slo", tone: "warn", label: "SLO B" })],
      }),
    ];

    const result = await collectSystemSignals({ contributors, principal });

    expect(result.merged.sysA.map((s) => s.source)).toEqual([
      "incident",
      "slo",
    ]);
    expect(result.merged.sysB).toHaveLength(1);
    expect(result.checkedSources.sort()).toEqual(["incident", "slo"]);
    expect(result.inaccessibleSources).toEqual([]);
    expect(result.failedSources).toEqual([]);
  });

  test("reports an inaccessible source distinctly (not as empty/clear)", async () => {
    const contributors = [
      denied("incident"),
      ok("slo", { sysA: [signal({ source: "slo" })] }),
    ];

    const result = await collectSystemSignals({ contributors, principal });

    // The denied source contributes no signals but IS surfaced so the model
    // can say "could not check incidents" instead of "no incidents".
    expect(Object.keys(result.merged)).toEqual(["sysA"]);
    expect(result.inaccessibleSources).toEqual(["incident"]);
    expect(result.checkedSources).toEqual(["slo"]);
    expect(result.failedSources).toEqual([]);
  });

  test("reports a throwing contributor as failed without breaking the call", async () => {
    const contributors = [
      throwing("boom"),
      ok("incident", { sysA: [signal({ source: "incident" })] }),
    ];

    const result = await collectSystemSignals({ contributors, principal });

    expect(Object.keys(result.merged)).toEqual(["sysA"]);
    expect(result.failedSources).toEqual(["boom"]);
    expect(result.checkedSources).toEqual(["incident"]);
  });

  test("no contributors produces no entries and empty coverage", async () => {
    const result = await collectSystemSignals({ contributors: [], principal });
    expect(result.merged).toEqual({});
    expect(result.checkedSources).toEqual([]);
    expect(result.inaccessibleSources).toEqual([]);
    expect(result.failedSources).toEqual([]);
  });
});

describe("toSystemIssuesOutput", () => {
  test("groups signals by system and counts totals", () => {
    const out = toSystemIssuesOutput({
      collection: emptyCollection({
        sysA: [signal({ source: "incident" }), signal({ source: "slo" })],
        sysB: [signal({ source: "anomaly" })],
      }),
    });

    expect(out.totalSystems).toBe(2);
    expect(out.totalSignals).toBe(3);
    const sysA = out.systems.find((s) => s.systemId === "sysA");
    expect(sysA?.signals.map((s) => s.source)).toEqual(["incident", "slo"]);
  });

  test("passes per-source coverage through to the output", () => {
    const out = toSystemIssuesOutput({
      collection: {
        merged: { sysA: [signal()] },
        checkedSources: ["incident", "slo"],
        inaccessibleSources: ["healthcheck"],
        failedSources: ["dependency"],
      },
    });

    expect(out.checkedSources).toEqual(["incident", "slo"]);
    expect(out.inaccessibleSources).toEqual(["healthcheck"]);
    expect(out.failedSources).toEqual(["dependency"]);
  });

  test("narrows to the requested systemIds", () => {
    const out = toSystemIssuesOutput({
      collection: emptyCollection({
        sysA: [signal()],
        sysB: [signal()],
      }),
      systemIds: ["sysB"],
    });

    expect(out.systems.map((s) => s.systemId)).toEqual(["sysB"]);
    expect(out.totalSystems).toBe(1);
  });

  test("drops href/accessRule/iconName, keeps source/tone/label/detail/since", () => {
    const out = toSystemIssuesOutput({
      collection: emptyCollection({
        sysA: [
          signal({
            detail: "2 of 3 checks failing",
            since: "2026-06-07T00:00:00Z",
            href: "/checkstack/x",
            accessRule: {
              id: "x",
              resource: "x",
              level: "read",
              pluginId: "p",
              description: "view x",
            },
            iconName: "TriangleAlert",
          }),
        ],
      }),
    });

    const s = out.systems[0].signals[0];
    expect(s).toEqual({
      source: "incident",
      tone: "error",
      label: "Critical incident",
      detail: "2 of 3 checks failing",
      since: "2026-06-07T00:00:00Z",
    });
  });
});
