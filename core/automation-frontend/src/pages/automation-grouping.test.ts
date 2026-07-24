import { describe, expect, it, test } from "bun:test";
import type { Automation, AutomationDefinition } from "@checkstack/automation-common";
import {
  filterAutomationsByQuery,
  groupAutomations,
  UNGROUPED_LABEL,
} from "./automation-grouping";

const DEFINITION: AutomationDefinition = {
  name: "n",
  triggers: [{ event: "incident.incident.created" }],
  conditions: [],
  actions: [],
  mode: "single",
  concurrency_scope: "automation",
  max_runs: 10,
};

function make({
  id,
  group,
}: {
  id: string;
  group?: string;
}): Automation {
  return {
    id,
    name: `Automation ${id}`,
    group,
    runAs: null,
    status: "enabled",
    definition: DEFINITION,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("groupAutomations", () => {
  it("returns an empty list for no automations", () => {
    expect(groupAutomations({ automations: [] })).toEqual([]);
  });

  it("puts automations with no group into the Ungrouped bucket", () => {
    const groups = groupAutomations({
      automations: [make({ id: "1" }), make({ id: "2", group: "  " })],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe(UNGROUPED_LABEL);
    expect(groups[0]?.ungrouped).toBe(true);
    expect(groups[0]?.items.map((a) => a.id)).toEqual(["1", "2"]);
  });

  it("groups by group value and sorts named groups alphabetically", () => {
    const groups = groupAutomations({
      automations: [
        make({ id: "1", group: "Zeta" }),
        make({ id: "2", group: "alpha" }),
        make({ id: "3", group: "Zeta" }),
      ],
    });
    expect(groups.map((g) => g.label)).toEqual(["alpha", "Zeta"]);
    expect(groups[1]?.items.map((a) => a.id)).toEqual(["1", "3"]);
  });

  it("always places the Ungrouped bucket last", () => {
    const groups = groupAutomations({
      automations: [
        make({ id: "1" }),
        make({ id: "2", group: "Networking" }),
        make({ id: "3", group: "Alerting" }),
      ],
    });
    expect(groups.map((g) => g.label)).toEqual([
      "Alerting",
      "Networking",
      UNGROUPED_LABEL,
    ]);
  });

  it("never emits empty groups", () => {
    const groups = groupAutomations({
      automations: [make({ id: "1", group: "Only" })],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Only");
    expect(groups.some((g) => g.items.length === 0)).toBe(false);
  });
});

describe("filterAutomationsByQuery", () => {
  const rows = [
    { name: "Nightly backup", group: "Ops" },
    { name: "Deploy notifier", group: "Release" },
    { name: "Cleanup", group: undefined },
  ] as Automation[];

  const names = (query: string) =>
    filterAutomationsByQuery({ automations: rows, query }).map((a) => a.name);

  test("matches the name, case-insensitively on a substring", () => {
    expect(names("NIGHT")).toEqual(["Nightly backup"]);
  });

  test("matches the group label too", () => {
    // The group is a heading the reader can see, so it is fair to search.
    expect(names("release")).toEqual(["Deploy notifier"]);
  });

  test("an ungrouped automation is still searchable by name", () => {
    expect(names("cleanup")).toEqual(["Cleanup"]);
  });

  test("an empty or whitespace query returns the same reference", () => {
    // An idle search box must not re-group the list on every render.
    expect(filterAutomationsByQuery({ automations: rows, query: "" })).toBe(rows);
    expect(filterAutomationsByQuery({ automations: rows, query: "  " })).toBe(
      rows,
    );
  });

  test("a query matching nothing yields an empty list, not every row", () => {
    expect(names("nonexistent")).toEqual([]);
  });
});
