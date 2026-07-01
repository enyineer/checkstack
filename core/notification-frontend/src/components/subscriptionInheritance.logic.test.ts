import { describe, it, expect } from "bun:test";
import type { SubscriptionInheritance } from "@checkstack/notification-common";
import {
  collectStatusGroupIds,
  buildRowInheritance,
} from "./subscriptionInheritance.logic";

const INHERITANCE: SubscriptionInheritance = [
  {
    specId: "incident.system",
    groupId: "incident.system.system-1",
    inheritance: [
      { groupId: "incident.group.group-1", label: "Platform Team" },
    ],
  },
  {
    specId: "anomaly.system",
    groupId: "anomaly.system.system-1",
    inheritance: [],
  },
];

describe("collectStatusGroupIds", () => {
  it("unions primary and inherited group ids, deduped and primaries-first", () => {
    const result = collectStatusGroupIds({
      primaryGroupIds: ["incident.system.system-1", "anomaly.system.system-1"],
      inheritance: INHERITANCE,
    });

    expect(result).toEqual([
      "incident.system.system-1",
      "anomaly.system.system-1",
      "incident.group.group-1",
    ]);
  });

  it("does not duplicate an inherited id that is also a primary id", () => {
    const result = collectStatusGroupIds({
      primaryGroupIds: ["incident.group.group-1"],
      inheritance: [
        {
          specId: "incident.group",
          groupId: "incident.group.group-1",
          inheritance: [
            { groupId: "incident.group.group-1", label: "self" },
          ],
        },
      ],
    });

    expect(result).toEqual(["incident.group.group-1"]);
  });

  it("returns just the primaries when there is no inheritance", () => {
    const result = collectStatusGroupIds({
      primaryGroupIds: ["a", "b"],
      inheritance: [],
    });

    expect(result).toEqual(["a", "b"]);
  });
});

describe("buildRowInheritance", () => {
  it("enriches each inherited parent with the caller's subscribed flag", () => {
    const result = buildRowInheritance({
      specId: "incident.system",
      inheritance: INHERITANCE,
      statusMap: { "incident.group.group-1": true },
    });

    expect(result.inheritance).toEqual([
      {
        groupId: "incident.group.group-1",
        label: "Platform Team",
        subscribed: true,
      },
    ]);
    expect(result.inheritanceStatus).toEqual({
      "incident.group.group-1": true,
    });
  });

  it("defaults subscribed to false when the parent group is absent from the status map", () => {
    const result = buildRowInheritance({
      specId: "incident.system",
      inheritance: INHERITANCE,
      statusMap: {},
    });

    expect(result.inheritance[0].subscribed).toBe(false);
    expect(result.inheritanceStatus).toEqual({
      "incident.group.group-1": false,
    });
  });

  it("returns empty structures for a spec with no parents", () => {
    const result = buildRowInheritance({
      specId: "anomaly.system",
      inheritance: INHERITANCE,
      statusMap: {},
    });

    expect(result.inheritance).toEqual([]);
    expect(result.inheritanceStatus).toEqual({});
  });

  it("returns empty structures for an unknown spec id", () => {
    const result = buildRowInheritance({
      specId: "does.not.exist",
      inheritance: INHERITANCE,
      statusMap: {},
    });

    expect(result.inheritance).toEqual([]);
    expect(result.inheritanceStatus).toEqual({});
  });
});
