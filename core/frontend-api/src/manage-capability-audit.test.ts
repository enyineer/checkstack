import { describe, expect, it } from "bun:test";
import type { AccessRule, ResourceType } from "@checkstack/common";
import { auditManageCapabilities } from "./manage-capability-audit";
import type { FrontendPlugin, ManageCapability, NavEntry } from "./plugin";

// The team-scopable set the backend would derive from its contracts. `group` is
// deliberately absent (a global-only, non-team-scoped resource).
const TEAM_SCOPABLE = new Set<string>([
  "catalog.system",
  "incident.incident",
]);

function rule({
  pluginId,
  resource,
  level,
}: {
  pluginId: string;
  resource: string;
  level: "read" | "manage";
}): AccessRule {
  return {
    id: `${resource}.${level}`,
    resource,
    pluginId,
    level,
    description: `${resource} ${level}`,
  };
}

function type(value: string): ResourceType {
  return value as ResourceType;
}

function plugin({
  pluginId,
  accessRule,
  manageCapability,
  nav,
  level = "manage",
  resource,
  path = "/x",
}: {
  pluginId: string;
  resource: string;
  level?: "read" | "manage";
  accessRule?: AccessRule;
  manageCapability?: ManageCapability;
  nav?: NavEntry;
  path?: string;
}): FrontendPlugin {
  return {
    metadata: { pluginId },
    routes: [
      {
        route: { id: `${pluginId}.r`, pluginId, path, params: [] },
        element: null,
        accessRule: accessRule ?? rule({ pluginId, resource, level }),
        manageCapability,
        nav,
      },
    ],
  };
}

describe("auditManageCapabilities", () => {
  it("passes a manage route on a team-scopable type with a matching capability", () => {
    const gaps = auditManageCapabilities({
      teamScopableTypes: TEAM_SCOPABLE,
      plugins: [
        plugin({
          pluginId: "catalog",
          resource: "system",
          manageCapability: { objectType: type("catalog.system") },
        }),
      ],
    });
    expect(gaps).toEqual([]);
  });

  it("flags a manage route on a team-scopable type with NO capability", () => {
    const gaps = auditManageCapabilities({
      teamScopableTypes: TEAM_SCOPABLE,
      plugins: [plugin({ pluginId: "catalog", resource: "system" })],
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("missing");
    expect(gaps[0].expectedType).toBe("catalog.system");
    expect(gaps[0].where).toBe("route");
  });

  it("flags a capability whose objectType is not the route's team-scopable type", () => {
    const gaps = auditManageCapabilities({
      teamScopableTypes: TEAM_SCOPABLE,
      plugins: [
        plugin({
          pluginId: "catalog",
          resource: "system",
          manageCapability: { objectType: type("incident.incident") },
        }),
      ],
    });
    expect(gaps.map((g) => g.kind).sort()).toEqual(["mismatch"]);
    const mismatch = gaps.find((g) => g.kind === "mismatch");
    expect(mismatch?.expectedType).toBe("catalog.system");
    expect(mismatch?.declaredType).toBe("incident.incident");
  });

  it("does NOT flag a manage route on a global-only (non-team-scoped) type", () => {
    const gaps = auditManageCapabilities({
      teamScopableTypes: TEAM_SCOPABLE,
      plugins: [plugin({ pluginId: "catalog", resource: "group" })],
    });
    expect(gaps).toEqual([]);
  });

  it("does NOT flag a read route", () => {
    const gaps = auditManageCapabilities({
      teamScopableTypes: TEAM_SCOPABLE,
      plugins: [plugin({ pluginId: "catalog", resource: "system", level: "read" })],
    });
    expect(gaps).toEqual([]);
  });

  it("flags a capability referencing an object type no backend team-scopes", () => {
    const gaps = auditManageCapabilities({
      teamScopableTypes: TEAM_SCOPABLE,
      plugins: [
        // Non-manage route so the mismatch/missing checks don't fire; only the
        // unknown-object-type dead-gate check should.
        plugin({
          pluginId: "catalog",
          resource: "system",
          level: "read",
          manageCapability: { objectType: type("catalog.ghost") },
        }),
      ],
    });
    expect(gaps.map((g) => g.kind)).toEqual(["unknown-object-type"]);
    expect(gaps[0].declaredType).toBe("catalog.ghost");
  });

  it("flags a capability whose parentType no backend team-scopes", () => {
    const gaps = auditManageCapabilities({
      teamScopableTypes: TEAM_SCOPABLE,
      plugins: [
        plugin({
          pluginId: "catalog",
          resource: "system",
          manageCapability: {
            objectType: type("catalog.system"),
            parentType: type("catalog.ghost"),
          },
        }),
      ],
    });
    expect(gaps.map((g) => g.kind)).toEqual(["unknown-parent-type"]);
    expect(gaps[0].declaredType).toBe("catalog.ghost");
  });

  it("audits a nav entry that OVERRIDES the gating rule with its own accessRule", () => {
    const gaps = auditManageCapabilities({
      teamScopableTypes: TEAM_SCOPABLE,
      plugins: [
        plugin({
          pluginId: "catalog",
          resource: "system",
          level: "read", // route itself reads
          nav: {
            group: "G",
            icon: () => null,
            // nav surfaces on a manage rule but declares no capability
            accessRule: rule({
              pluginId: "catalog",
              resource: "system",
              level: "manage",
            }),
          },
        }),
      ],
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].where).toBe("nav");
    expect(gaps[0].kind).toBe("missing");
  });
});
