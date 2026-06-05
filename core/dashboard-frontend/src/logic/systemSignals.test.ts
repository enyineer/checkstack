import { describe, expect, it } from "bun:test";
import type { SystemSignal } from "@checkstack/catalog-common";
import {
  buildProblemSystems,
  countByTone,
  mergeSignalsBySystem,
  sortSignals,
  type SignalsBySource,
} from "./systemSignals";

const signal = (
  source: string,
  tone: SystemSignal["tone"],
  label: string,
  since?: string,
): SystemSignal => ({ source, tone, label, since });

describe("mergeSignalsBySystem", () => {
  it("merges signals from multiple sources per system", () => {
    const bySource: SignalsBySource = {
      incident: { sysA: [signal("incident", "error", "Critical incident")] },
      slo: {
        sysA: [signal("slo", "warn", "SLO at risk")],
        sysB: [signal("slo", "error", "SLO breaching")],
      },
    };
    const merged = mergeSignalsBySystem(bySource);
    expect(merged.sysA).toHaveLength(2);
    expect(merged.sysB).toHaveLength(1);
  });

  it("drops empty signal arrays so a cleared source contributes nothing", () => {
    const bySource: SignalsBySource = {
      incident: { sysA: [] },
      slo: { sysA: [signal("slo", "warn", "SLO at risk")] },
    };
    const merged = mergeSignalsBySystem(bySource);
    expect(merged.sysA).toHaveLength(1);
  });
});

describe("sortSignals", () => {
  it("orders error before warn before info", () => {
    const sorted = sortSignals([
      signal("a", "info", "i"),
      signal("b", "error", "e"),
      signal("c", "warn", "w"),
    ]);
    expect(sorted.map((s) => s.tone)).toEqual(["error", "warn", "info"]);
  });

  it("orders oldest first within the same tone", () => {
    const sorted = sortSignals([
      signal("a", "warn", "newer", "2026-06-04T12:00:00.000Z"),
      signal("b", "warn", "older", "2026-06-04T10:00:00.000Z"),
    ]);
    expect(sorted.map((s) => s.label)).toEqual(["older", "newer"]);
  });
});

describe("buildProblemSystems", () => {
  it("excludes systems with no signals and derives worst tone", () => {
    const problems = buildProblemSystems({
      sysA: [signal("slo", "warn", "SLO at risk"), signal("incident", "error", "Critical")],
      sysB: [],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].systemId).toBe("sysA");
    expect(problems[0].worstTone).toBe("error");
    expect(problems[0].signalCount).toBe(2);
  });

  it("sorts by worst tone, then signal count, then oldest", () => {
    const problems = buildProblemSystems({
      warnOne: [signal("slo", "warn", "w")],
      errorOne: [signal("incident", "error", "e")],
      errorTwo: [
        signal("incident", "error", "e1"),
        signal("slo", "error", "e2"),
      ],
    });
    // errorTwo (2 signals) before errorOne (1 signal), both before warnOne.
    expect(problems.map((p) => p.systemId)).toEqual([
      "errorTwo",
      "errorOne",
      "warnOne",
    ]);
  });

  it("computes the oldest since across a system's signals", () => {
    const problems = buildProblemSystems({
      sysA: [
        signal("incident", "error", "newer", "2026-06-04T12:00:00.000Z"),
        signal("maintenance", "info", "older", "2026-06-04T08:00:00.000Z"),
      ],
    });
    expect(problems[0].oldestSince).toBe("2026-06-04T08:00:00.000Z");
  });
});

describe("countByTone", () => {
  it("counts each system once by its worst tone", () => {
    const problems = buildProblemSystems({
      a: [signal("incident", "error", "e"), signal("slo", "warn", "w")],
      b: [signal("slo", "warn", "w")],
      c: [signal("maintenance", "info", "i")],
    });
    expect(countByTone(problems)).toEqual({ error: 1, warn: 1, info: 1 });
  });
});
