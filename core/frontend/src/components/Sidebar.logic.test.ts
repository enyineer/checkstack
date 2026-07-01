import { describe, expect, test } from "bun:test";
import { resourceType, type AccessRule } from "@checkstack/common";
import { selectNavGroups, type NavLike } from "./Sidebar.logic";

const GROUP_ORDER = ["Workspace", "Configuration", "Documentation"] as const;

// Rules carry an owning pluginId; checks match the qualified `${pluginId}.${id}`.
const rule = (id: string): AccessRule =>
  ({ id, resource: id, level: "read", pluginId: "p" }) as unknown as AccessRule;

interface Route {
  path: string;
  nav?: NavLike;
}

const route = (path: string, nav?: Partial<NavLike>): Route => ({
  path,
  nav: nav ? { group: "Configuration", label: path, order: 0, ...nav } : undefined,
});

describe("selectNavGroups", () => {
  test("drops routes without nav", () => {
    const groups = selectNavGroups({
      routes: [route("/a"), route("/b", { group: "Workspace" })],
      accessRules: [],
      isAuthenticated: true,
      groupOrder: GROUP_ORDER,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((r) => r.path)).toEqual(["/b"]);
  });

  test("hides an entry whose accessRule the user lacks, and drops the now-empty group", () => {
    const groups = selectNavGroups({
      routes: [route("/secret", { group: "Configuration", accessRule: rule("x.manage") })],
      accessRules: [], // anonymous / no grants
      isAuthenticated: true,
      groupOrder: GROUP_ORDER,
    });
    // The only Configuration entry is gated away -> the group is not returned.
    expect(groups).toEqual([]);
  });

  test("shows an entry whose accessRule the user satisfies", () => {
    const groups = selectNavGroups({
      routes: [route("/ok", { accessRule: rule("x.read") })],
      accessRules: ["p.x.read"],
      isAuthenticated: true,
      groupOrder: GROUP_ORDER,
    });
    expect(groups[0]?.items.map((r) => r.path)).toEqual(["/ok"]);
  });

  test("isVisible predicate gates the entry (Infrastructure: any readable tab)", () => {
    // Simulate Infrastructure: visible only if the user can read a tab. Here the
    // predicate returns false, so the entry (and its lone group) vanish.
    const infra = route("/infrastructure", {
      isVisible: ({ accessRules }) => accessRules.includes("queue.read"),
    });
    expect(
      selectNavGroups({
        routes: [infra],
        accessRules: [],
        isAuthenticated: true,
        groupOrder: GROUP_ORDER,
      }),
    ).toEqual([]);
    // With the tab grant, it appears.
    expect(
      selectNavGroups({
        routes: [infra],
        accessRules: ["queue.read"],
        isAuthenticated: true,
        groupOrder: GROUP_ORDER,
      })[0]?.items.map((r) => r.path),
    ).toEqual(["/infrastructure"]);
  });

  test("isVisible receives isAuthenticated (Notification: authenticated only)", () => {
    const notif = route("/notification", {
      isVisible: ({ isAuthenticated }) => isAuthenticated,
    });
    expect(
      selectNavGroups({
        routes: [notif],
        accessRules: [],
        isAuthenticated: false,
        groupOrder: GROUP_ORDER,
      }),
    ).toEqual([]);
    expect(
      selectNavGroups({
        routes: [notif],
        accessRules: [],
        isAuthenticated: true,
        groupOrder: GROUP_ORDER,
      })[0]?.items.map((r) => r.path),
    ).toEqual(["/notification"]);
  });

  test("shows a manageCapability entry when the team set has its objectType, without the global rule", () => {
    const objectType = resourceType({ pluginId: "p" }, "thing");
    const groups = selectNavGroups({
      routes: [route("/mgmt", { accessRule: rule("x.manage"), manageCapability: { objectType } })],
      accessRules: [], // no global rule
      isAuthenticated: true,
      groupOrder: GROUP_ORDER,
      manageableTypes: new Set<string>([objectType]),
    });
    expect(groups[0]?.items.map((r) => r.path)).toEqual(["/mgmt"]);
  });

  test("shows a manageCapability entry via its parentType (managing the parent unlocks it)", () => {
    const objectType = resourceType({ pluginId: "p" }, "child");
    const parentType = resourceType({ pluginId: "cat" }, "system");
    const groups = selectNavGroups({
      routes: [
        route("/child", {
          accessRule: rule("x.manage"),
          manageCapability: { objectType, parentType },
        }),
      ],
      accessRules: [],
      isAuthenticated: true,
      groupOrder: GROUP_ORDER,
      manageableTypes: new Set<string>([parentType]),
    });
    expect(groups[0]?.items.map((r) => r.path)).toEqual(["/child"]);
  });

  test("hides a manageCapability entry when the team set lacks the type and the rule is absent", () => {
    const objectType = resourceType({ pluginId: "p" }, "thing");
    const groups = selectNavGroups({
      routes: [route("/mgmt", { accessRule: rule("x.manage"), manageCapability: { objectType } })],
      accessRules: [],
      isAuthenticated: true,
      groupOrder: GROUP_ORDER,
      manageableTypes: new Set<string>(["something.else"]),
    });
    expect(groups).toEqual([]);
  });

  test("both accessRule AND isVisible must pass", () => {
    const r = route("/both", {
      accessRule: rule("x.read"),
      isVisible: ({ isAuthenticated }) => isAuthenticated,
    });
    // Has the rule but not authenticated -> hidden.
    expect(
      selectNavGroups({
        routes: [r],
        accessRules: ["p.x.read"],
        isAuthenticated: false,
        groupOrder: GROUP_ORDER,
      }),
    ).toEqual([]);
  });

  test("orders groups by groupOrder then alphabetically, items by order then label", () => {
    const groups = selectNavGroups({
      routes: [
        route("/z", { group: "Documentation", order: 0, label: "Z" }),
        route("/w", { group: "Workspace", order: 0, label: "W" }),
        route("/c2", { group: "Configuration", order: 2, label: "C2" }),
        route("/c1", { group: "Configuration", order: 1, label: "C1" }),
        route("/x", { group: "Xtra", order: 0, label: "X" }), // unknown group -> last
      ],
      accessRules: [],
      isAuthenticated: true,
      groupOrder: GROUP_ORDER,
    });
    expect(groups.map((g) => g.group)).toEqual([
      "Workspace",
      "Configuration",
      "Documentation",
      "Xtra",
    ]);
    expect(
      groups.find((g) => g.group === "Configuration")?.items.map((r) => r.path),
    ).toEqual(["/c1", "/c2"]);
  });

  test("marks single-entry groups flat and multi-entry groups not flat", () => {
    const groups = selectNavGroups({
      routes: [
        route("/solo", { group: "Workspace" }),
        route("/c1", { group: "Configuration", order: 1 }),
        route("/c2", { group: "Configuration", order: 2 }),
      ],
      accessRules: [],
      isAuthenticated: true,
      groupOrder: GROUP_ORDER,
    });
    expect(groups.find((g) => g.group === "Workspace")?.flat).toBe(true);
    expect(groups.find((g) => g.group === "Configuration")?.flat).toBe(false);
  });
});
