import { describe, it, expect } from "bun:test";
import { collectResourceKinds } from "./plugin-manager";

/**
 * Unit tests for collectResourceKinds — the contract scan that powers the teams
 * admin UI's resource-kind list. We fake the minimal `~orpc.meta` shape it reads.
 */

function proc(meta: {
  access?: Array<{ pluginId: string; resource: string }>;
  instanceAccess?: Record<string, unknown>;
}) {
  return { ["~orpc"]: { meta } };
}

describe("collectResourceKinds", () => {
  it("returns nothing for procedures without instanceAccess", () => {
    const contract = {
      list: proc({ access: [{ pluginId: "catalog", resource: "system" }] }),
    };
    expect(collectResourceKinds([contract])).toEqual([]);
  });

  it("derives the qualified resource type and a humanized label", () => {
    const contract = {
      get: proc({
        access: [{ pluginId: "healthcheck", resource: "configuration" }],
        instanceAccess: { idParam: "id" },
      }),
    };
    expect(collectResourceKinds([contract])).toEqual([
      {
        resourceType: "healthcheck.configuration",
        label: "Configuration",
        pluginId: "healthcheck",
        createCapable: false,
      },
    ]);
  });

  it("marks a type create-capable when any procedure opts into create mode", () => {
    const contract = {
      list: proc({
        access: [{ pluginId: "catalog", resource: "system" }],
        instanceAccess: { listKey: "systems" },
      }),
      create: proc({
        access: [{ pluginId: "catalog", resource: "system" }],
        instanceAccess: { create: { idField: "id" } },
      }),
    };
    const kinds = collectResourceKinds([contract]);
    expect(kinds).toHaveLength(1);
    expect(kinds[0]).toMatchObject({
      resourceType: "catalog.system",
      createCapable: true,
    });
  });

  it("does NOT mark a parent-gated create as create-capable", () => {
    // A parent-gated create (e.g. incident/maintenance "for a system") is
    // authorized via MANAGE on the parent, so it must not surface a per-type
    // create toggle.
    const contract = {
      list: proc({
        access: [{ pluginId: "incident", resource: "incident" }],
        instanceAccess: { listKey: "incidents" },
      }),
      create: proc({
        access: [{ pluginId: "incident", resource: "incident" }],
        instanceAccess: {
          create: {
            idField: "id",
            parent: { resourceType: "catalog.system", idParam: "systemIds" },
          },
        },
      }),
    };
    const kinds = collectResourceKinds([contract]);
    expect(kinds).toHaveLength(1);
    expect(kinds[0]).toMatchObject({
      resourceType: "incident.incident",
      createCapable: false,
    });
  });

  it("keeps create-capable true when a parent-less create coexists with a parent-gated one", () => {
    // OR across procedures: a type with BOTH a parent-less and a parent-gated
    // create is still create-capable (the parent-less path needs the grant).
    const contract = {
      createStandalone: proc({
        access: [{ pluginId: "healthcheck", resource: "healthcheck" }],
        instanceAccess: { create: { idField: "id" } },
      }),
      createForParent: proc({
        access: [{ pluginId: "healthcheck", resource: "healthcheck" }],
        instanceAccess: {
          create: {
            idField: "id",
            parent: { resourceType: "catalog.system", idParam: "systemId" },
          },
        },
      }),
    };
    const kinds = collectResourceKinds([contract]);
    expect(kinds[0]).toMatchObject({
      resourceType: "healthcheck.healthcheck",
      createCapable: true,
    });
  });

  it("dedupes across contracts and sorts by resource type", () => {
    const a = {
      create: proc({
        access: [{ pluginId: "slo", resource: "slo" }],
        instanceAccess: { create: {} },
      }),
    };
    const b = {
      get: proc({
        access: [{ pluginId: "catalog", resource: "system" }],
        instanceAccess: { idParam: "id" },
      }),
    };
    const kinds = collectResourceKinds([a, b]);
    expect(kinds.map((k) => k.resourceType)).toEqual([
      "catalog.system",
      "slo.slo",
    ]);
  });
});
