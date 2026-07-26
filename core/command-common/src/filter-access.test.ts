import { describe, it, expect } from "bun:test";
import { filterByAccessRules } from "./index";

/**
 * Behavioral guard for command-palette visibility.
 *
 * The regression this pins: commands were filtered against the caller's GLOBAL
 * access rules only, so a team-scoped user holding a create-capability grant
 * (and no global `*.manage` rule) never saw "Create Incident" / "Create
 * Maintenance" - the palette hid the actions from exactly the people allowed to
 * run them. `manageCapability` + `manageableTypes` is the team-grant arm.
 */
type Item = {
  id: string;
  requiredAccessRules?: string[];
  manageCapability?: { objectType: string; parentType?: string };
};

const incidentCreate: Item = {
  id: "incident.create",
  requiredAccessRules: ["incident.incident.manage"],
  manageCapability: { objectType: "incident.incident" },
};

/** A command with a global rule but NO capability declared (the old shape). */
const globalOnly: Item = {
  id: "admin.thing",
  requiredAccessRules: ["auth.users.manage"],
};

describe("filterByAccessRules", () => {
  it("shows items that require no access rules", () => {
    const open: Item = { id: "open" };
    expect(filterByAccessRules([open], [])).toEqual([open]);
  });

  it("shows everything to a wildcard holder", () => {
    expect(
      filterByAccessRules([incidentCreate, globalOnly], ["*"]),
    ).toHaveLength(2);
  });

  it("shows an item to a caller holding every required global rule", () => {
    expect(
      filterByAccessRules([incidentCreate], ["incident.incident.manage"]),
    ).toEqual([incidentCreate]);
  });

  it("REGRESSION: shows a create command to a team-scoped user via manageCapability", () => {
    // No global rule at all - only a team grant on the declared type.
    const result = filterByAccessRules(
      [incidentCreate],
      [],
      new Set(["incident.incident"]),
    );
    expect(result).toEqual([incidentCreate]);
  });

  it("hides the item from a caller with neither the global rule nor a team grant", () => {
    expect(filterByAccessRules([incidentCreate], [], new Set())).toEqual([]);
  });

  it("hides the item when the team grant is for an unrelated type", () => {
    expect(
      filterByAccessRules([incidentCreate], [], new Set(["catalog.system"])),
    ).toEqual([]);
  });

  it("honors a parentType grant (managing the parent unlocks the child)", () => {
    const item: Item = {
      id: "incident.create",
      requiredAccessRules: ["incident.incident.manage"],
      manageCapability: {
        objectType: "incident.incident",
        parentType: "catalog.system",
      },
    };
    expect(
      filterByAccessRules([item], [], new Set(["catalog.system"])),
    ).toEqual([item]);
  });

  it("does NOT let a team grant rescue an item that declares no capability", () => {
    // Without an explicit manageCapability the item stays global-only, so a
    // stray team grant must not widen it.
    expect(
      filterByAccessRules([globalOnly], [], new Set(["auth.users"])),
    ).toEqual([]);
  });

  it("defaults to pure global-rule gating when no team set is passed", () => {
    expect(filterByAccessRules([incidentCreate], [])).toEqual([]);
  });

  it("requires ALL global rules when several are declared", () => {
    const item: Item = { id: "x", requiredAccessRules: ["a.read", "b.manage"] };
    expect(filterByAccessRules([item], ["a.read"])).toEqual([]);
    expect(filterByAccessRules([item], ["a.read", "b.manage"])).toEqual([item]);
  });
});
