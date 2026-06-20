import { describe, test, expect } from "bun:test";
import {
  deriveOverallStatus,
  overallStatusLabel,
  OverallStatusSummarySchema,
  type OverallStatus,
} from "./overall-status";
import { BUILTIN_WIDGET_IDS, type PublicStatus } from "./widget-types";
import type { ResolvedBlock } from "./schemas";

let nextId = 0;
const id = () => `b${nextId++}`;

function bannerBlock(status: PublicStatus): ResolvedBlock {
  return {
    id: id(),
    type: BUILTIN_WIDGET_IDS.banner,
    data: { status, title: "x" },
  };
}

function systemHealthBlock(statuses: PublicStatus[]): ResolvedBlock {
  return {
    id: id(),
    type: BUILTIN_WIDGET_IDS.systemHealth,
    data: {
      systems: statuses.map((status, i) => ({ label: `s${i}`, status })),
    },
  };
}

function groupBlock(
  groupStatus: PublicStatus,
  members: PublicStatus[],
): ResolvedBlock {
  return {
    id: id(),
    type: BUILTIN_WIDGET_IDS.groupStatus,
    data: {
      label: "g",
      status: groupStatus,
      systems: members.map((status, i) => ({ label: `m${i}`, status })),
    },
  };
}

/** bars are oldest-first; the LAST bar is "today". */
function uptimeBlock(barStatuses: PublicStatus[]): ResolvedBlock {
  return {
    id: id(),
    type: BUILTIN_WIDGET_IDS.uptime,
    data: {
      label: "u",
      uptimePct: 99,
      bars: barStatuses.map((status, i) => ({
        date: `2026-06-${String(i + 1).padStart(2, "0")}`,
        uptimePct: 99,
        status,
      })),
    },
  };
}

function contentBlock(): ResolvedBlock {
  return {
    id: id(),
    type: BUILTIN_WIDGET_IDS.text,
    data: { markdown: "hello" },
  };
}

describe("deriveOverallStatus", () => {
  test("operational when every signal is operational", () => {
    const result = deriveOverallStatus({
      blocks: [
        systemHealthBlock(["operational", "operational"]),
        bannerBlock("operational"),
        uptimeBlock(["major_outage", "operational"]), // only the latest bar counts
      ],
    });
    expect(result.status).toBe("operational");
    expect(result.label).toBe("All systems operational");
  });

  test("worst-status-wins: major_outage beats everything", () => {
    const result = deriveOverallStatus({
      blocks: [
        systemHealthBlock(["operational", "degraded"]),
        bannerBlock("partial_outage"),
        groupBlock("major_outage", ["operational"]),
      ],
    });
    expect(result.status).toBe("major_outage");
    expect(result.label).toBe("Major outage");
  });

  test("partial_outage beats degraded and maintenance", () => {
    const result = deriveOverallStatus({
      blocks: [
        systemHealthBlock(["degraded", "maintenance"]),
        bannerBlock("partial_outage"),
      ],
    });
    expect(result.status).toBe("partial_outage");
  });

  test("degraded beats maintenance and operational", () => {
    const result = deriveOverallStatus({
      blocks: [systemHealthBlock(["operational", "maintenance", "degraded"])],
    });
    expect(result.status).toBe("degraded");
  });

  test("maintenance is surfaced above operational", () => {
    const result = deriveOverallStatus({
      blocks: [
        systemHealthBlock(["operational", "operational"]),
        bannerBlock("maintenance"),
      ],
    });
    expect(result.status).toBe("maintenance");
    expect(result.label).toBe("Under maintenance");
  });

  test("an active outage outranks a maintenance window", () => {
    const result = deriveOverallStatus({
      blocks: [bannerBlock("maintenance"), bannerBlock("major_outage")],
    });
    expect(result.status).toBe("major_outage");
  });

  test("unknown fallback for an empty page", () => {
    const result = deriveOverallStatus({ blocks: [] });
    expect(result.status).toBe("unknown");
    expect(result.label).toBe("Status unknown");
  });

  test("unknown fallback for a page of only content widgets", () => {
    const result = deriveOverallStatus({
      blocks: [contentBlock(), contentBlock()],
    });
    expect(result.status).toBe("unknown");
  });

  test("explicit unknown signal is outranked by any real status", () => {
    const result = deriveOverallStatus({
      blocks: [systemHealthBlock(["unknown", "operational"])],
    });
    expect(result.status).toBe("operational");
  });

  test("a page reporting only unknown stays unknown", () => {
    const result = deriveOverallStatus({
      blocks: [systemHealthBlock(["unknown", "unknown"])],
    });
    expect(result.status).toBe("unknown");
  });

  test("group's own rolled-up status contributes even with no members", () => {
    const result = deriveOverallStatus({
      blocks: [groupBlock("major_outage", [])],
    });
    expect(result.status).toBe("major_outage");
  });

  test("uptime widget uses the most recent bar (current health)", () => {
    const result = deriveOverallStatus({
      blocks: [uptimeBlock(["operational", "operational", "degraded"])],
    });
    expect(result.status).toBe("degraded");
  });

  test("uptime widget with no bars contributes nothing", () => {
    const result = deriveOverallStatus({
      blocks: [uptimeBlock([]), bannerBlock("operational")],
    });
    expect(result.status).toBe("operational");
  });

  test("malformed / foreign block data is ignored, not crashed", () => {
    const malformed: ResolvedBlock = {
      id: id(),
      type: BUILTIN_WIDGET_IDS.banner,
      data: { nope: true },
    };
    const foreign: ResolvedBlock = {
      id: id(),
      type: "third-party.widget",
      data: { status: "major_outage" },
    };
    const nullData: ResolvedBlock = {
      id: id(),
      type: BUILTIN_WIDGET_IDS.systemHealth,
      data: null,
    };
    const result = deriveOverallStatus({
      blocks: [malformed, foreign, nullData, bannerBlock("degraded")],
    });
    expect(result.status).toBe("degraded");
  });

  test("output validates against OverallStatusSummarySchema", () => {
    const result = deriveOverallStatus({
      blocks: [bannerBlock("partial_outage")],
    });
    expect(OverallStatusSummarySchema.parse(result)).toEqual(result);
  });

  test("overallStatusLabel covers every status", () => {
    const statuses: OverallStatus[] = [
      "operational",
      "degraded",
      "partial_outage",
      "major_outage",
      "maintenance",
      "unknown",
    ];
    for (const s of statuses) {
      expect(overallStatusLabel(s).length).toBeGreaterThan(0);
    }
  });
});
