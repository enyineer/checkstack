import { describe, it, expect } from "bun:test";
import { unionPrimaryGroupIds } from "./bulkSubscriptionStatus.logic";

const SYSTEM_TYPE = "catalog.system";
const GROUP_TYPE = "catalog.group";

const SPECS = [
  {
    targetTypeId: SYSTEM_TYPE,
    ownerPlugin: "incident",
    localId: "system",
  },
  {
    targetTypeId: SYSTEM_TYPE,
    ownerPlugin: "anomaly",
    localId: "system",
  },
  {
    targetTypeId: GROUP_TYPE,
    ownerPlugin: "incident",
    localId: "group",
  },
];

describe("unionPrimaryGroupIds", () => {
  it("emits one group id per matching-target spec for every resource", () => {
    const result = unionPrimaryGroupIds({
      specs: SPECS,
      resources: [
        { targetTypeId: SYSTEM_TYPE, resourceKey: "sys-1" },
        { targetTypeId: SYSTEM_TYPE, resourceKey: "sys-2" },
        { targetTypeId: GROUP_TYPE, resourceKey: "grp-1" },
      ],
    });

    expect(result).toEqual([
      // sys-1: both system specs
      "incident.system.sys-1",
      "anomaly.system.sys-1",
      // sys-2: both system specs
      "incident.system.sys-2",
      "anomaly.system.sys-2",
      // grp-1: the group spec only
      "incident.group.grp-1",
    ]);
  });

  it("only matches specs whose targetTypeId equals the resource's", () => {
    const result = unionPrimaryGroupIds({
      specs: SPECS,
      // A group resource must NOT pick up system specs, and vice-versa.
      resources: [{ targetTypeId: GROUP_TYPE, resourceKey: "grp-1" }],
    });

    expect(result).toEqual(["incident.group.grp-1"]);
  });

  it("deduplicates repeated (spec x resourceKey) pairs", () => {
    const result = unionPrimaryGroupIds({
      specs: SPECS,
      resources: [
        { targetTypeId: SYSTEM_TYPE, resourceKey: "sys-1" },
        // Same resource visible twice (e.g. in two groups) must not double-fetch.
        { targetTypeId: SYSTEM_TYPE, resourceKey: "sys-1" },
      ],
    });

    expect(result).toEqual([
      "incident.system.sys-1",
      "anomaly.system.sys-1",
    ]);
  });

  it("returns an empty array with no resources or no matching specs", () => {
    expect(unionPrimaryGroupIds({ specs: SPECS, resources: [] })).toEqual([]);
    expect(
      unionPrimaryGroupIds({
        specs: [],
        resources: [{ targetTypeId: SYSTEM_TYPE, resourceKey: "sys-1" }],
      }),
    ).toEqual([]);
  });
});
