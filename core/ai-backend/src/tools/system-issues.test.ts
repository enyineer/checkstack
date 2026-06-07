import { describe, test, expect } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import type { SystemSignal, SystemSignalsMap } from "@checkstack/catalog-common";
import type { SystemSignalsContributor } from "../extension-points";
import {
  mergeSystemSignalsMaps,
  collectSystemSignals,
  toSystemIssuesOutput,
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

const contributor = (
  sourceId: string,
  read: (ctx: { principal: AuthUser }) => Promise<SystemSignalsMap>,
): SystemSignalsContributor => ({ sourceId, read });

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
  test("merges signals from multiple contributors by systemId", async () => {
    const contributors = [
      contributor("incident", async () => ({
        sysA: [signal({ source: "incident" })],
      })),
      contributor("slo", async () => ({
        sysA: [signal({ source: "slo", tone: "warn", label: "SLO" })],
        sysB: [signal({ source: "slo", tone: "warn", label: "SLO B" })],
      })),
    ];

    const merged = await collectSystemSignals({ contributors, principal });

    expect(merged.sysA.map((s) => s.source)).toEqual(["incident", "slo"]);
    expect(merged.sysB).toHaveLength(1);
  });

  test("skips a throwing contributor without breaking the whole call", async () => {
    const contributors = [
      contributor("boom", async () => {
        throw new Error("source exploded");
      }),
      contributor("incident", async () => ({
        sysA: [signal({ source: "incident" })],
      })),
    ];

    const merged = await collectSystemSignals({ contributors, principal });

    // The healthy source still contributed; the thrower was skipped.
    expect(Object.keys(merged)).toEqual(["sysA"]);
    expect(merged.sysA).toHaveLength(1);
  });

  test("tolerates a contributor returning an empty map", async () => {
    const contributors = [
      contributor("noaccess", async () => ({})),
      contributor("incident", async () => ({
        sysA: [signal({ source: "incident" })],
      })),
    ];

    const merged = await collectSystemSignals({ contributors, principal });

    expect(Object.keys(merged)).toEqual(["sysA"]);
  });

  test("no contributors produces no entries", async () => {
    const merged = await collectSystemSignals({ contributors: [], principal });
    expect(merged).toEqual({});
  });

  test("all contributors empty produces no entries", async () => {
    const contributors = [
      contributor("a", async () => ({})),
      contributor("b", async () => ({})),
    ];
    const merged = await collectSystemSignals({ contributors, principal });
    expect(merged).toEqual({});
  });
});

describe("toSystemIssuesOutput", () => {
  test("groups signals by system and counts totals", () => {
    const out = toSystemIssuesOutput({
      merged: {
        sysA: [signal({ source: "incident" }), signal({ source: "slo" })],
        sysB: [signal({ source: "anomaly" })],
      },
    });

    expect(out.totalSystems).toBe(2);
    expect(out.totalSignals).toBe(3);
    const sysA = out.systems.find((s) => s.systemId === "sysA");
    expect(sysA?.signals.map((s) => s.source)).toEqual(["incident", "slo"]);
  });

  test("narrows to the requested systemIds", () => {
    const out = toSystemIssuesOutput({
      merged: {
        sysA: [signal()],
        sysB: [signal()],
      },
      systemIds: ["sysB"],
    });

    expect(out.systems.map((s) => s.systemId)).toEqual(["sysB"]);
    expect(out.totalSystems).toBe(1);
  });

  test("drops href/accessRule/iconName, keeps source/tone/label/detail/since", () => {
    const out = toSystemIssuesOutput({
      merged: {
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
      },
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
