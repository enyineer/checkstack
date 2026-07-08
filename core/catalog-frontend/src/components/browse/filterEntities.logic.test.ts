import { describe, expect, test } from "bun:test";
import type { System, Group } from "@checkstack/catalog-common";
import {
  buildBrowseModel,
  filterManagementLists,
  systemTags,
  collectTagOptions,
} from "./filterEntities.logic";
import {
  DEFAULT_BROWSE_STATE,
  UNGROUPED_ID,
  type BrowseState,
} from "./browseState.logic";

const NOW = new Date("2026-01-01T00:00:00Z");

function makeSystem(props: Partial<System> & { id: string; name: string }): System {
  return {
    description: null,
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...props,
  };
}

function makeGroup(props: Partial<Group> & { id: string; name: string }): Group {
  return {
    systemIds: [],
    sortOrder: 0,
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...props,
  };
}

function state(overrides: Partial<BrowseState> = {}): BrowseState {
  return { ...DEFAULT_BROWSE_STATE, ...overrides };
}

const checkout = makeSystem({
  id: "s-checkout",
  name: "checkout-api",
  description: "Handles payments checkout",
  metadata: { team: "payments", tier: 1 },
});
const ledger = makeSystem({ id: "s-ledger", name: "ledger-worker" });
const auth = makeSystem({ id: "s-auth", name: "auth-service" });
const orphan = makeSystem({ id: "s-orphan", name: "lonely-system" });

const payments = makeGroup({
  id: "g-payments",
  name: "Payments",
  systemIds: ["s-checkout", "s-ledger"],
});
const platform = makeGroup({
  id: "g-platform",
  name: "Platform",
  systemIds: ["s-auth", "s-checkout"], // checkout is in two groups
});

const ALL_SYSTEMS = [checkout, ledger, auth, orphan];
const ALL_GROUPS = [payments, platform];

describe("systemTags", () => {
  test("emits bare-key and key=value tokens for string-coerced metadata", () => {
    expect(systemTags(checkout)).toEqual([
      "team",
      "team=payments",
      "tier",
      "tier=1",
    ]);
  });

  test("returns [] for systems without metadata", () => {
    expect(systemTags(ledger)).toEqual([]);
  });
});

describe("collectTagOptions", () => {
  test("collects distinct key=value tokens, sorted, excluding bare keys", () => {
    expect(collectTagOptions(ALL_SYSTEMS)).toEqual([
      "team=payments",
      "tier=1",
    ]);
  });

  test("returns [] when no system has string metadata", () => {
    expect(collectTagOptions([ledger, auth])).toEqual([]);
  });
});

describe("buildBrowseModel — partitioning", () => {
  test("empty catalog is flagged", () => {
    const model = buildBrowseModel({ systems: [], groups: [], state: state() });
    expect(model.isEmptyCatalog).toBe(true);
    expect(model.sections).toEqual([]);
  });

  test("partitions systems into group sections plus a synthetic ungrouped section", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state(),
    });
    const ids = model.sections.map((s) => s.id);
    expect(ids).toEqual(["g-payments", "g-platform", UNGROUPED_ID]);

    const ungrouped = model.sections.find((s) => s.isUngrouped);
    expect(ungrouped?.systems.map((s) => s.id)).toEqual(["s-orphan"]);
  });

  test("a system in multiple groups appears under each", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state(),
    });
    const paymentsSection = model.sections.find((s) => s.id === "g-payments");
    const platformSection = model.sections.find((s) => s.id === "g-platform");
    expect(paymentsSection?.systems.map((s) => s.id)).toContain("s-checkout");
    expect(platformSection?.systems.map((s) => s.id)).toContain("s-checkout");
  });

  test("header count reflects total members, not filtered survivors", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "ledger" }),
    });
    const paymentsSection = model.sections.find((s) => s.id === "g-payments");
    expect(paymentsSection?.totalCount).toBe(2);
    expect(paymentsSection?.systems.map((s) => s.id)).toEqual(["s-ledger"]);
  });

  test("no ungrouped section when every system belongs to a group", () => {
    const everyGrouped = makeGroup({
      id: "g-all",
      name: "All",
      systemIds: ["s-checkout", "s-ledger", "s-auth", "s-orphan"],
    });
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: [everyGrouped],
      state: state(),
    });
    expect(model.sections.some((s) => s.isUngrouped)).toBe(false);
  });
});

describe("buildBrowseModel — search", () => {
  test("matches name case-insensitively", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "CHECKOUT" }),
    });
    const matched = model.sections.flatMap((s) => s.systems.map((x) => x.id));
    expect(matched).toContain("s-checkout");
    expect(matched).not.toContain("s-auth");
  });

  test("matches description", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "Handles payments" }),
    });
    const matched = model.sections.flatMap((s) => s.systems.map((x) => x.id));
    expect(matched).toEqual(["s-checkout", "s-checkout"]); // both groups it's in
  });

  test("groups with zero matches drop out entirely under an active query", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "checkout" }),
    });
    // Payments + Platform both contain checkout; ungrouped (orphan) drops.
    expect(model.sections.map((s) => s.id)).toEqual(["g-payments", "g-platform"]);
  });

  test("a matching section auto-expands under query", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "checkout", open: {} }),
    });
    expect(model.sections.every((s) => s.open)).toBe(true);
  });

  test("an explicit forced-closed override beats search auto-expand", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "checkout", open: { "g-payments": false } }),
    });
    const paymentsSection = model.sections.find((s) => s.id === "g-payments");
    expect(paymentsSection?.open).toBe(false);
  });
});

describe("buildBrowseModel — filters compose (AND)", () => {
  test("tag + query compose", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "checkout", tag: "team=payments" }),
    });
    const matched = model.sections.flatMap((s) => s.systems.map((x) => x.id));
    expect(new Set(matched)).toEqual(new Set(["s-checkout"]));
  });

  test("tag filter excludes systems without the tag", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ tag: "team=payments" }),
    });
    const matched = model.sections.flatMap((s) => s.systems.map((x) => x.id));
    expect(matched).not.toContain("s-ledger");
    expect(matched).not.toContain("s-auth");
  });

  test("group filter narrows to one section", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ group: "g-payments" }),
    });
    expect(model.sections.map((s) => s.id)).toEqual(["g-payments"]);
  });

  test("group filter can select the synthetic ungrouped section", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ group: UNGROUPED_ID }),
    });
    expect(model.sections.map((s) => s.id)).toEqual([UNGROUPED_ID]);
  });
});

describe("buildBrowseModel — health rollups + filter", () => {
  test("group rollup is derived from status DATA, over ALL members pre-filter", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state(),
      statuses: {
        "s-checkout": "healthy",
        "s-ledger": "degraded",
        "s-auth": "healthy",
      },
    });
    const payments = model.sections.find((s) => s.id === "g-payments");
    expect(payments?.rollup.hasData).toBe(true);
    expect(payments?.rollup.allHealthy).toBe(false);
    expect(payments?.rollup.degraded).toBe(1);
    expect(payments?.rollup.worst).toBe("degraded");
  });

  test("all-healthy group derived from data (healthy members emit no badge)", () => {
    const model = buildBrowseModel({
      systems: [auth, checkout],
      groups: [platform],
      state: state(),
      statuses: { "s-auth": "healthy", "s-checkout": "healthy" },
    });
    const platformSection = model.sections.find((s) => s.id === "g-platform");
    expect(platformSection?.rollup.allHealthy).toBe(true);
  });

  test("no statuses → rollup hasData false (counts only), no crash", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state(),
    });
    expect(model.sections.every((s) => s.rollup.hasData === false)).toBe(true);
  });

  test("all-healthy group starts collapsed; non-healthy group starts expanded", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state(),
      statuses: {
        "s-checkout": "healthy",
        "s-ledger": "healthy",
        "s-auth": "healthy",
      },
    });
    // payments = {checkout, ledger} both healthy → collapsed.
    expect(model.sections.find((s) => s.id === "g-payments")?.open).toBe(false);
    // ungrouped = {orphan} has no data → not allHealthy → expanded.
    expect(model.sections.find((s) => s.id === UNGROUPED_ID)?.open).toBe(true);
  });

  test("URL open override beats the collapse-all-healthy default", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ open: { "g-payments": true } }),
      statuses: { "s-checkout": "healthy", "s-ledger": "healthy" },
    });
    expect(model.sections.find((s) => s.id === "g-payments")?.open).toBe(true);
  });

  test("health filter hides healthy rows; unknown matches no-data systems", () => {
    const degraded = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ health: "degraded" }),
      statuses: { "s-checkout": "degraded", "s-ledger": "healthy" },
    });
    const matched = degraded.sections.flatMap((s) =>
      s.systems.map((x) => x.id),
    );
    expect(new Set(matched)).toEqual(new Set(["s-checkout"]));

    const unknown = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ health: "unknown" }),
      statuses: { "s-checkout": "degraded", "s-ledger": "healthy" },
    });
    const unknownMatched = unknown.sections.flatMap((s) =>
      s.systems.map((x) => x.id),
    );
    // s-auth + s-orphan have no reported status → unknown.
    expect(unknownMatched).toContain("s-auth");
    expect(unknownMatched).toContain("s-orphan");
    expect(unknownMatched).not.toContain("s-checkout");
  });
});

describe("buildBrowseModel — empty states", () => {
  test("filtered-to-empty sets isFilteredEmpty (not isEmptyCatalog)", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "nonexistent-zzz" }),
    });
    expect(model.isEmptyCatalog).toBe(false);
    expect(model.isFilteredEmpty).toBe(true);
  });

  test("no filters + populated catalog is neither empty nor filtered-empty", () => {
    const model = buildBrowseModel({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state(),
    });
    expect(model.isEmptyCatalog).toBe(false);
    expect(model.isFilteredEmpty).toBe(false);
  });
});

describe("filterManagementLists", () => {
  test("no filters returns all systems and groups unchanged", () => {
    const model = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state(),
    });
    expect(model.systems.map((s) => s.id)).toEqual([
      "s-checkout",
      "s-ledger",
      "s-auth",
      "s-orphan",
    ]);
    expect(model.groups.map((g) => g.id)).toEqual(["g-payments", "g-platform"]);
    expect(model.isEmptyCatalog).toBe(false);
  });

  test("empty catalog is flagged", () => {
    const model = filterManagementLists({ systems: [], groups: [], state: state() });
    expect(model.isEmptyCatalog).toBe(true);
    expect(model.systems).toEqual([]);
    expect(model.groups).toEqual([]);
  });

  test("query filters systems by name and keeps groups that contain a match", () => {
    const model = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "checkout" }),
    });
    expect(model.systems.map((s) => s.id)).toEqual(["s-checkout"]);
    // checkout is in both payments + platform, so both groups survive.
    expect(model.groups.map((g) => g.id)).toEqual(["g-payments", "g-platform"]);
  });

  test("query matches a group's own name even with no matching member", () => {
    const model = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "Platform" }),
    });
    expect(model.groups.map((g) => g.id)).toContain("g-platform");
  });

  test("tag filter narrows the systems list", () => {
    const model = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ tag: "team=payments" }),
    });
    expect(model.systems.map((s) => s.id)).toEqual(["s-checkout"]);
  });

  test("group filter narrows systems to members and to the one group", () => {
    const model = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ group: "g-payments" }),
    });
    expect(model.systems.map((s) => s.id)).toEqual(["s-checkout", "s-ledger"]);
    expect(model.groups.map((g) => g.id)).toEqual(["g-payments"]);
  });

  test("ungrouped group filter shows only ungrouped systems and no real group", () => {
    const model = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ group: UNGROUPED_ID }),
    });
    expect(model.systems.map((s) => s.id)).toEqual(["s-orphan"]);
    expect(model.groups).toEqual([]);
  });

  test("filtered-to-empty yields empty lists, not isEmptyCatalog", () => {
    const model = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "nonexistent-zzz" }),
    });
    expect(model.isEmptyCatalog).toBe(false);
    expect(model.systems).toEqual([]);
    expect(model.groups).toEqual([]);
  });

  test("health filter narrows systems by reported status; unknown matches no-data", () => {
    const statuses = { "s-checkout": "degraded", "s-ledger": "healthy" } as const;
    const degradedOnly = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ health: "degraded" }),
      statuses,
    });
    expect(degradedOnly.systems.map((s) => s.id)).toEqual(["s-checkout"]);

    const unknownOnly = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ health: "unknown" }),
      statuses,
    });
    // s-auth and s-orphan have no reported status → unknown.
    expect(unknownOnly.systems.map((s) => s.id)).toEqual(["s-auth", "s-orphan"]);
  });

  test("clearing query restores all (no stale filtering)", () => {
    const filtered = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "checkout" }),
    });
    expect(filtered.systems.length).toBe(1);
    const cleared = filterManagementLists({
      systems: ALL_SYSTEMS,
      groups: ALL_GROUPS,
      state: state({ query: "" }),
    });
    expect(cleared.systems.length).toBe(ALL_SYSTEMS.length);
    expect(cleared.groups.length).toBe(ALL_GROUPS.length);
  });
});
