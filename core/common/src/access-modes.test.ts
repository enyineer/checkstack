import { describe, it, expect } from "bun:test";
import {
  ACCESS_MODE_KEYS,
  ACCESS_MODE_DESCRIPTORS,
  buildAuthorizationSpec,
} from "./access-modes";
import { access, type AccessRule, type InstanceAccessConfig } from "./access-utils";

/** Build an AccessRule with an optional instanceAccess attached. */
function rule(
  resource: string,
  level: "read" | "manage",
  pluginId: string,
  instanceAccess?: InstanceAccessConfig,
): AccessRule {
  return {
    ...access(resource, level, `${resource} ${level}`, { pluginId }),
    instanceAccess,
  };
}

describe("ACCESS_MODE_DESCRIPTORS", () => {
  it("has exactly one descriptor per declared mode key", () => {
    expect(Object.keys(ACCESS_MODE_DESCRIPTORS).sort()).toEqual(
      [...ACCESS_MODE_KEYS].sort(),
    );
  });

  it("every descriptor's key matches its map entry", () => {
    for (const key of ACCESS_MODE_KEYS) {
      expect(ACCESS_MODE_DESCRIPTORS[key].key).toBe(key);
    }
  });
});

describe("buildAuthorizationSpec", () => {
  it("a global-only rule requires that rule and adds no instance clause", () => {
    const spec = buildAuthorizationSpec(
      { userType: "authenticated", access: [rule("system", "read", "catalog")] },
      "catalog",
    );
    expect(spec.globalRules).toEqual(["catalog.system.read"]);
    expect(spec.instance).toEqual([]);
    expect(spec.summary).toContain("catalog.system.read");
    expect(spec.summary).toContain("Requires an authenticated user or application");
  });

  it("an idParam rule becomes a global OR-override plus a team-grant clause", () => {
    const spec = buildAuthorizationSpec(
      {
        userType: "authenticated",
        access: [rule("system", "read", "catalog", { idParam: "systemId" })],
      },
      "catalog",
    );
    expect(spec.globalRules).toEqual(["catalog.system.read"]);
    expect(spec.instance).toHaveLength(1);
    expect(spec.instance[0].mode).toBe("idParam");
    expect(spec.instance[0].facts).toMatchObject({
      resourceType: "catalog.system",
      action: "read",
      idParam: "systemId",
    });
    expect(spec.summary).toContain("catalog.system.read");
    expect(spec.summary).toContain("team read grant on the catalog.system");
    expect(spec.summary).toContain("`systemId`");
  });

  it("a contract-level objectRef override applies to the access rule (admin OR per-object)", () => {
    const spec = buildAuthorizationSpec(
      {
        userType: "authenticated",
        access: [rule("teams", "manage", "auth")],
        instanceAccess: {
          objectRef: { typeParam: "objectType", idParam: "objectId", action: "manage" },
        },
      },
      "auth",
    );
    expect(spec.globalRules).toEqual(["auth.teams.manage"]);
    expect(spec.instance).toHaveLength(1);
    expect(spec.instance[0].mode).toBe("objectRef");
    expect(spec.instance[0].facts).toMatchObject({
      typeParam: "objectType",
      idParam: "objectId",
      action: "manage",
      dynamicType: true,
    });
    expect(spec.summary).toContain("auth.teams.manage");
    expect(spec.summary).toContain("`objectType`/`objectId`");
    expect(spec.summary).toContain("team-private objects require a team grant");
  });

  it("parentScope describes the parent type and its id path", () => {
    const spec = buildAuthorizationSpec(
      {
        access: [
          rule("incident", "read", "incident", {
            parentScope: { resourceType: "catalog.system", idParam: "systemId", action: "read" },
          }),
        ],
      },
      "incident",
    );
    expect(spec.instance[0].mode).toBe("parentScope");
    expect(spec.instance[0].facts).toMatchObject({
      parentResourceType: "catalog.system",
      action: "read",
    });
    expect(spec.summary).toContain("parent catalog.system");
    expect(spec.summary).toContain("`systemId`");
  });

  it("global:true is the opt-out — the rule is required, no instance clause", () => {
    const spec = buildAuthorizationSpec(
      { access: [rule("strategy", "read", "healthcheck", { global: true })] },
      "healthcheck",
    );
    expect(spec.globalRules).toEqual(["healthcheck.strategy.read"]);
    expect(spec.instance).toEqual([]);
  });

  it("bulkManage explains per-id partitioning", () => {
    const spec = buildAuthorizationSpec(
      {
        access: [
          rule("incident", "manage", "incident", { bulkManage: { idsParam: "ids" } }),
        ],
      },
      "incident",
    );
    expect(spec.instance[0].mode).toBe("bulkManage");
    expect(spec.summary).toContain("`ids`");
    expect(spec.summary).toContain("forbidden");
  });

  it("typeScoped describes 'any team grant of the type'", () => {
    const spec = buildAuthorizationSpec(
      {
        access: [rule("system", "read", "catalog", { typeScoped: {} })],
      },
      "catalog",
    );
    expect(spec.instance[0].mode).toBe("typeScoped");
    expect(spec.summary).toContain("ANY team grant for catalog.system");
  });

  it("no access rules yields an honest 'no additional access rule' summary", () => {
    const spec = buildAuthorizationSpec({ userType: "public", access: [] }, "catalog");
    expect(spec.globalRules).toEqual([]);
    expect(spec.instance).toEqual([]);
    expect(spec.summary).toContain("No additional access rule");
    expect(spec.summary).toContain("Open to anyone");
  });

  it("renders a handler-enforced accessNote as a distinct additional rule", () => {
    const spec = buildAuthorizationSpec(
      {
        userType: "authenticated",
        access: [rule("configuration", "read", "healthcheck")],
        accessNote: {
          summary:
            "also authorized by a team read grant on the configuration or an assigned system",
        },
      },
      "healthcheck",
    );
    expect(spec.globalRules).toEqual(["healthcheck.configuration.read"]);
    expect(spec.handlerNote).toContain("assigned system");
    // The note is surfaced as an explicitly handler-enforced addendum, NOT folded
    // into the machine-derived OR-list.
    expect(spec.summary).toContain("Additional handler-enforced rule:");
    expect(spec.summary).toContain("assigned system");
  });

  it("anonymous endpoints read as no-auth-required", () => {
    const spec = buildAuthorizationSpec({ userType: "anonymous", access: [] }, "status-page");
    expect(spec.summary).toContain("No authentication required");
  });
});
