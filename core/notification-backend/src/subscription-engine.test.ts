import { describe, it, expect } from "bun:test";
import { deriveGroupId, mapInheritedGroups } from "./subscription-engine";

/**
 * Unit tests for the pure inheritance join (`mapInheritedGroups`) that
 * powers BOTH dispatch (`resolveInheritedGroupIds`) and the
 * `resolveSubscriptionInheritance` read proc. It encodes the group-vs-
 * system resolution rule without a DB:
 *
 *   inherited group = for each parent edge, the SAME owner plugin's spec
 *   whose targetTypeId matches the parent's target type, keyed on the
 *   parent's resourceKey.
 */

const SYSTEM_TARGET = "catalog.system";
const GROUP_TARGET = "catalog.group";

// A system spec + its matching group spec, both owned by "incident".
const incidentSystemSpec = {
  ownerPlugin: "incident",
  localId: "system",
  targetTypeId: SYSTEM_TARGET,
};
const incidentGroupSpec = {
  ownerPlugin: "incident",
  localId: "group",
  targetTypeId: GROUP_TARGET,
};
// A group spec owned by a DIFFERENT plugin.
const anomalyGroupSpec = {
  ownerPlugin: "anomaly",
  localId: "group",
  targetTypeId: GROUP_TARGET,
};

describe("mapInheritedGroups", () => {
  it("yields the parent group's derived group id for a matching same-plugin group spec", () => {
    const result = mapInheritedGroups({
      ownerPlugin: incidentSystemSpec.ownerPlugin,
      parents: [
        { parentTargetTypeId: GROUP_TARGET, parentResourceKey: "group-1" },
      ],
      parentSpecs: [incidentGroupSpec],
    });

    expect(result).toEqual([
      {
        groupId: deriveGroupId({
          ownerPlugin: "incident",
          localId: "group",
          resourceKey: "group-1",
        }),
        parentTargetTypeId: GROUP_TARGET,
        parentResourceKey: "group-1",
      },
    ]);
  });

  it("yields nothing when no parent spec matches the parent target type", () => {
    const result = mapInheritedGroups({
      ownerPlugin: incidentSystemSpec.ownerPlugin,
      parents: [
        { parentTargetTypeId: GROUP_TARGET, parentResourceKey: "group-1" },
      ],
      // Only a spec for the system target exists - no group spec to inherit.
      parentSpecs: [incidentSystemSpec],
    });

    expect(result).toEqual([]);
  });

  it("excludes parent specs owned by a different plugin", () => {
    const result = mapInheritedGroups({
      ownerPlugin: incidentSystemSpec.ownerPlugin,
      parents: [
        { parentTargetTypeId: GROUP_TARGET, parentResourceKey: "group-1" },
      ],
      // A group spec exists, but it belongs to "anomaly", not "incident".
      parentSpecs: [anomalyGroupSpec],
    });

    expect(result).toEqual([]);
  });

  it("produces one inherited group per (parent x matching parentSpec)", () => {
    const result = mapInheritedGroups({
      ownerPlugin: incidentSystemSpec.ownerPlugin,
      parents: [
        { parentTargetTypeId: GROUP_TARGET, parentResourceKey: "group-1" },
        { parentTargetTypeId: GROUP_TARGET, parentResourceKey: "group-2" },
      ],
      // Both an in-plugin match and an off-plugin decoy; only the match counts.
      parentSpecs: [incidentGroupSpec, anomalyGroupSpec],
    });

    expect(result.map((g) => g.groupId)).toEqual([
      deriveGroupId({
        ownerPlugin: "incident",
        localId: "group",
        resourceKey: "group-1",
      }),
      deriveGroupId({
        ownerPlugin: "incident",
        localId: "group",
        resourceKey: "group-2",
      }),
    ]);
  });

  it("returns an empty array when there are no parent edges", () => {
    const result = mapInheritedGroups({
      ownerPlugin: incidentSystemSpec.ownerPlugin,
      parents: [],
      parentSpecs: [incidentGroupSpec],
    });

    expect(result).toEqual([]);
  });
});
