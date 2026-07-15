import { describe, expect, it } from "bun:test";
import { accessPair } from "./access-utils";
import type { InstanceAccessConfig } from "./access-utils";
import type { ProcedureMetadata } from "./types";
import {
  resolveProcedureGate,
  type ProcedureWithMeta,
} from "./procedure-gate";

const PLUGIN_ID = "automation";

// The `manage` rule for resource "automation" — its qualified type is
// `automation.automation` (the value the backend keys team grants on).
const automationAccess = accessPair(
  "automation",
  { read: { description: "read" }, manage: { description: "manage" } },
  { pluginId: PLUGIN_ID },
);

/**
 * Build a minimal contract-procedure stand-in carrying the given metadata under
 * oRPC's `~orpc.meta`, exactly the shape `resolveProcedureGate` reads.
 */
function procedure(meta: ProcedureMetadata): ProcedureWithMeta {
  return { "~orpc": { meta } };
}

function meta(
  access: ProcedureMetadata["access"],
  instanceAccess?: InstanceAccessConfig,
): ProcedureMetadata {
  return {
    userType: "authenticated",
    operationType: "mutation",
    access,
    instanceAccess,
  };
}

describe("resolveProcedureGate", () => {
  it("classifies a missing instanceAccess as a global-rule gate", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(meta([automationAccess.manage])),
    });
    expect(gate.kind).toBe("global");
    expect(gate.objectType).toBe("automation.automation");
    expect(gate.accessRule).toBe(automationAccess.manage);
    expect(gate.action).toBe("manage");
  });

  it("classifies explicit global:true as a global-rule gate", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(meta([automationAccess.manage], { global: true })),
    });
    expect(gate.kind).toBe("global");
  });

  it("classifies listKey / recordKey / bulkManage as open (post-filtered)", () => {
    for (const ia of [
      { listKey: "items" },
      { recordKey: "byId" },
      { bulkManage: { idsParam: "ids" } },
    ] satisfies InstanceAccessConfig[]) {
      const gate = resolveProcedureGate({
        procedure: procedure(meta([automationAccess.read], ia)),
      });
      expect(gate.kind).toBe("open");
    }
  });

  it("classifies idParam and resolves the resource id from the input", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(meta([automationAccess.manage], { idParam: "id" })),
      input: { id: "auto-1" },
    });
    expect(gate.kind).toBe("idParam");
    expect(gate.resourceId).toBe("auto-1");
    expect(gate.action).toBe("manage");
  });

  it("resolves a nested dot-notation idParam path", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(
        meta([automationAccess.read], { idParam: "params.systemId" }),
      ),
      input: { params: { systemId: "sys-9" } },
    });
    expect(gate.resourceId).toBe("sys-9");
  });

  it("leaves resourceId undefined when the input omits the id", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(meta([automationAccess.manage], { idParam: "id" })),
      input: {},
    });
    expect(gate.kind).toBe("idParam");
    expect(gate.resourceId).toBeUndefined();
  });

  it("uses the rule's own level for idParam action (read stays read)", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(meta([automationAccess.read], { idParam: "id" })),
      input: { id: "auto-1" },
    });
    expect(gate.action).toBe("read");
  });

  it("classifies create and surfaces the parent type when present", () => {
    const plain = resolveProcedureGate({
      procedure: procedure(
        meta([automationAccess.manage], {
          create: { teamIdParam: "teamId", idField: "id" },
        }),
      ),
    });
    expect(plain.kind).toBe("create");
    expect(plain.parentType).toBeUndefined();
    expect(plain.action).toBe("manage");

    const parented = resolveProcedureGate({
      procedure: procedure(
        meta([automationAccess.manage], {
          create: { parent: { resourceType: "catalog.system", idParam: "systemId" } },
        }),
      ),
    });
    expect(parented.kind).toBe("create");
    expect(parented.parentType).toBe("catalog.system");
    // Carries the synthetic parent-MANAGE rule so a global parent-manager is
    // offered the create affordance (the latent create.parent gap).
    expect(parented.parentAccessRule?.pluginId).toBe("catalog");
    expect(parented.parentAccessRule?.resource).toBe("system");
    expect(parented.parentAccessRule?.level).toBe("manage");
    expect(parented.parentAccessRule?.id).toBe("system.manage");
  });

  it("leaves parentAccessRule undefined for a create without a parent gate", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(
        meta([automationAccess.manage], {
          create: { teamIdParam: "teamId", idField: "id" },
        }),
      ),
    });
    expect(gate.parentAccessRule).toBeUndefined();
    expect(gate.alsoAcceptCreatorOf).toBeUndefined();
  });

  it("surfaces create.alsoAcceptCreatorOf sibling types on the gate", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(
        meta([automationAccess.manage], {
          create: {
            teamIdParam: "teamId",
            idField: "id",
            alsoAcceptCreatorOf: ["catalog.system"],
          },
        }),
      ),
    });
    expect(gate.kind).toBe("create");
    expect(gate.alsoAcceptCreatorOf).toEqual(["catalog.system"]);
  });

  it("classifies typeScoped and defaults its action to the rule level", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(meta([automationAccess.read], { typeScoped: {} })),
    });
    expect(gate.kind).toBe("typeScoped");
    expect(gate.action).toBe("read");

    const explicit = resolveProcedureGate({
      procedure: procedure(
        meta([automationAccess.read], { typeScoped: { action: "manage" } }),
      ),
    });
    expect(explicit.action).toBe("manage");
  });

  it("normalizes parentScope+idParam into an idParam gate on a synthetic parent rule", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(
        meta([automationAccess.manage], {
          parentScope: {
            resourceType: "catalog.system",
            action: "manage",
            idParam: "systemId",
          },
        }),
      ),
      input: { systemId: "sys-1" },
    });
    expect(gate.kind).toBe("idParam");
    // The team-grant check keys on the PARENT type.
    expect(gate.objectType).toBe("catalog.system");
    expect(gate.action).toBe("manage");
    expect(gate.resourceId).toBe("sys-1");
    // The synthetic parent rule reconstructs exactly the parent grant the backend
    // checks: qualified id `catalog.system.manage`.
    expect(gate.accessRule.pluginId).toBe("catalog");
    expect(gate.accessRule.resource).toBe("system");
    expect(gate.accessRule.level).toBe("manage");
    expect(gate.accessRule.id).toBe("system.manage");
  });

  it("defaults a parentScope action to read", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(
        meta([automationAccess.read], {
          parentScope: { resourceType: "catalog.system", idParam: "systemId" },
        }),
      ),
      input: { systemId: "sys-1" },
    });
    expect(gate.kind).toBe("idParam");
    expect(gate.action).toBe("read");
    expect(gate.accessRule.id).toBe("system.read");
  });

  it("normalizes the parentScope recordKey (post-filter) variant into open", () => {
    const gate = resolveProcedureGate({
      procedure: procedure(
        meta([automationAccess.read], {
          parentScope: { resourceType: "catalog.system", recordKey: "systems" },
        }),
      ),
    });
    expect(gate.kind).toBe("open");
    expect(gate.objectType).toBe("catalog.system");
  });

  it("throws when the procedure declares no access rule", () => {
    expect(() =>
      resolveProcedureGate({ procedure: procedure(meta([])) }),
    ).toThrow(/no access rule/);
  });
});
