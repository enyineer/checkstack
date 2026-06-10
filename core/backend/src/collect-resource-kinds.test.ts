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
