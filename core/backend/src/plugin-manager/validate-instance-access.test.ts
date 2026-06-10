import { describe, it, expect } from "bun:test";
import { z } from "zod";
import type { AnyContractRouter } from "@orpc/contract";
import { validateContractInstanceAccess } from "./plugin-loader";

/**
 * Unit tests for the boot-time instanceAccess validator. The validator reads
 * each procedure's `~orpc.meta.instanceAccess` and rejects a config that names
 * zero or more-than-one scoping mode (which the middleware would silently
 * mis-handle). We fake the minimal contract shape it inspects.
 */

function fakeContract(
  procs: Record<string, { instanceAccess?: Record<string, unknown> } | object>,
): AnyContractRouter {
  const contract: Record<string, unknown> = {};
  for (const [name, meta] of Object.entries(procs)) {
    contract[name] = { ["~orpc"]: { meta } };
  }
  return contract as unknown as AnyContractRouter;
}

// Like fakeContract, but also attaches an input schema alongside meta under
// `~orpc` so the input-path cross-check has something to introspect.
function fakeContractWithSchema(
  procs: Record<
    string,
    { instanceAccess?: Record<string, unknown>; inputSchema?: unknown }
  >,
): AnyContractRouter {
  const contract: Record<string, unknown> = {};
  for (const [name, { instanceAccess, inputSchema }] of Object.entries(procs)) {
    contract[name] = {
      ["~orpc"]: { meta: { instanceAccess }, inputSchema },
    };
  }
  return contract as unknown as AnyContractRouter;
}

// Full faker: per-proc instanceAccess + access rules ({resource, pluginId}) +
// userType + inputSchema, so the "explicit decision required" and parentScope
// checks (which read meta.access / meta.userType) can be exercised.
function fakeContractFull(
  procs: Record<
    string,
    {
      instanceAccess?: Record<string, unknown>;
      access?: Array<{ resource: string; pluginId: string }>;
      userType?: string;
      inputSchema?: unknown;
    }
  >,
): AnyContractRouter {
  const contract: Record<string, unknown> = {};
  for (const [name, { instanceAccess, access, userType, inputSchema }] of
    Object.entries(procs)) {
    contract[name] = {
      ["~orpc"]: { meta: { instanceAccess, access, userType }, inputSchema },
    };
  }
  return contract as unknown as AnyContractRouter;
}

function run(contract: AnyContractRouter): string[] {
  const errors: string[] = [];
  validateContractInstanceAccess({
    pluginId: "test",
    contract,
    validationErrors: errors,
  });
  return errors;
}

describe("validateContractInstanceAccess", () => {
  it("accepts procedures with no instanceAccess", () => {
    expect(run(fakeContract({ list: {}, get: {} }))).toEqual([]);
  });

  it("accepts each single valid mode", () => {
    const errors = run(
      fakeContract({
        getOne: { instanceAccess: { idParam: "id" } },
        list: { instanceAccess: { listKey: "items" } },
        bulk: { instanceAccess: { recordKey: "statuses" } },
        create: { instanceAccess: { create: { idField: "id" } } },
      }),
    );
    expect(errors).toEqual([]);
  });

  it("rejects an instanceAccess that names multiple modes", () => {
    const errors = run(
      fakeContract({
        bad: { instanceAccess: { idParam: "id", listKey: "items" } },
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("multiple instanceAccess modes");
    expect(errors[0]).toContain("idParam");
    expect(errors[0]).toContain("listKey");
  });

  it("rejects an empty instanceAccess object", () => {
    const errors = run(fakeContract({ empty: { instanceAccess: {} } }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("empty instanceAccess");
  });

  it("reports each offending procedure independently", () => {
    const errors = run(
      fakeContract({
        ok: { instanceAccess: { idParam: "id" } },
        bad1: { instanceAccess: { listKey: "a", recordKey: "b" } },
        bad2: { instanceAccess: {} },
      }),
    );
    expect(errors).toHaveLength(2);
  });

  describe("input-path cross-check", () => {
    it("skips the check when there is no input schema to introspect", () => {
      expect(run(fakeContract({ getOne: { instanceAccess: { idParam: "id" } } }))).toEqual([]);
    });

    it("accepts an idParam that exists in the input schema", () => {
      const errors = run(
        fakeContractWithSchema({
          getOne: {
            instanceAccess: { idParam: "systemId" },
            inputSchema: z.object({ systemId: z.string() }),
          },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("rejects an idParam missing from the input schema", () => {
      const errors = run(
        fakeContractWithSchema({
          getOne: {
            instanceAccess: { idParam: "sytemId" },
            inputSchema: z.object({ systemId: z.string() }),
          },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("instanceAccess.idParam");
      expect(errors[0]).toContain("sytemId");
    });

    it("does not flag a non-object input schema (cannot introspect)", () => {
      const errors = run(
        fakeContractWithSchema({
          getOne: {
            instanceAccess: { idParam: "id" },
            inputSchema: z.string(),
          },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("unwraps optional/default/nullable wrappers around the object", () => {
      const errors = run(
        fakeContractWithSchema({
          getOne: {
            instanceAccess: { idParam: "id" },
            inputSchema: z.object({ id: z.string() }).optional(),
          },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("resolves a nested dot-path through object shapes", () => {
      const present = run(
        fakeContractWithSchema({
          getOne: {
            instanceAccess: { idParam: "params.id" },
            inputSchema: z.object({ params: z.object({ id: z.string() }) }),
          },
        }),
      );
      expect(present).toEqual([]);

      const missing = run(
        fakeContractWithSchema({
          getOne: {
            instanceAccess: { idParam: "params.nope" },
            inputSchema: z.object({ params: z.object({ id: z.string() }) }),
          },
        }),
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]).toContain("params.nope");
    });

    it("flags a create-mode teamIdParam missing from the input schema", () => {
      const errors = run(
        fakeContractWithSchema({
          create: {
            instanceAccess: { create: { idField: "id" } },
            inputSchema: z.object({ name: z.string() }),
          },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("create.teamIdParam");
      expect(errors[0]).toContain("teamId");
    });

    it("accepts a create-mode with an optional teamId field", () => {
      const errors = run(
        fakeContractWithSchema({
          create: {
            instanceAccess: { create: { idField: "id" } },
            inputSchema: z.object({
              name: z.string(),
              teamId: z.string().optional(),
            }),
          },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("flags a create-mode parent.idParam missing from the input schema", () => {
      const errors = run(
        fakeContractWithSchema({
          create: {
            instanceAccess: {
              create: {
                idField: "id",
                parent: { resourceType: "catalog.system", idParam: "systemIds" },
              },
            },
            inputSchema: z.object({ teamId: z.string().optional() }),
          },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("create.parent.idParam");
      expect(errors[0]).toContain("systemIds");
    });
  });

  describe("global mode", () => {
    it("accepts instanceAccess: { global: true } as a single valid mode", () => {
      expect(run(fakeContract({ g: { instanceAccess: { global: true } } }))).toEqual([]);
    });

    it("rejects global combined with a scoping mode", () => {
      const errors = run(
        fakeContract({ g: { instanceAccess: { global: true, idParam: "id" } } }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("multiple instanceAccess modes");
      expect(errors[0]).toContain("global");
    });
  });

  describe("explicit-decision guard for team-scopable types", () => {
    const sysRule = { resource: "system", pluginId: "catalog" };

    it("flags an endpoint touching a scopable type with no instanceAccess", () => {
      const errors = run(
        fakeContractFull({
          // makes catalog.system scopable
          getOne: { instanceAccess: { idParam: "id" }, access: [sysRule] },
          // touches catalog.system but declares nothing -> fail-open
          listAll: { access: [sysRule] },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("listAll");
      expect(errors[0]).toContain("catalog.system");
      expect(errors[0]).toContain("fails OPEN");
    });

    it("accepts the unscoped endpoint once it declares global: true", () => {
      const errors = run(
        fakeContractFull({
          getOne: { instanceAccess: { idParam: "id" }, access: [sysRule] },
          listAll: { instanceAccess: { global: true }, access: [sysRule] },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("does not flag service or anonymous endpoints (they bypass instance checks)", () => {
      const errors = run(
        fakeContractFull({
          getOne: { instanceAccess: { idParam: "id" }, access: [sysRule] },
          svc: { access: [sysRule], userType: "service" },
          anon: { access: [sysRule], userType: "anonymous" },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("does not flag a type that is never scoped anywhere", () => {
      const groupRule = { resource: "group", pluginId: "catalog" };
      const errors = run(
        fakeContractFull({
          listGroups: { access: [groupRule] },
          getGroup: { access: [groupRule] },
        }),
      );
      expect(errors).toEqual([]);
    });
  });

  describe("parentScope mode", () => {
    const incidentRule = { resource: "incident", pluginId: "incident" };

    it("accepts parentScope with idParam present in the input schema", () => {
      const errors = run(
        fakeContractFull({
          forSystem: {
            instanceAccess: {
              parentScope: {
                resourceType: "catalog.system",
                action: "read",
                idParam: "systemId",
              },
            },
            access: [incidentRule],
            inputSchema: z.object({ systemId: z.string() }),
          },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("rejects parentScope missing resourceType", () => {
      const errors = run(
        fakeContractFull({
          forSystem: {
            instanceAccess: { parentScope: { idParam: "systemId" } },
            access: [incidentRule],
            inputSchema: z.object({ systemId: z.string() }),
          },
        }),
      );
      expect(errors.some((e) => e.includes("resourceType"))).toBe(true);
    });

    it("rejects parentScope that sets neither idParam nor recordKey", () => {
      const errors = run(
        fakeContractFull({
          forSystem: {
            instanceAccess: { parentScope: { resourceType: "catalog.system" } },
            access: [incidentRule],
          },
        }),
      );
      expect(errors.some((e) => e.includes("EXACTLY one"))).toBe(true);
    });

    it("rejects parentScope that sets BOTH idParam and recordKey", () => {
      const errors = run(
        fakeContractFull({
          forSystem: {
            instanceAccess: {
              parentScope: {
                resourceType: "catalog.system",
                idParam: "systemId",
                recordKey: "bySystem",
              },
            },
            access: [incidentRule],
            inputSchema: z.object({ systemId: z.string() }),
          },
        }),
      );
      expect(errors.some((e) => e.includes("EXACTLY one"))).toBe(true);
    });

    it("flags a parentScope.idParam missing from the input schema", () => {
      const errors = run(
        fakeContractFull({
          forSystem: {
            instanceAccess: {
              parentScope: { resourceType: "catalog.system", idParam: "sytemId" },
            },
            access: [incidentRule],
            inputSchema: z.object({ systemId: z.string() }),
          },
        }),
      );
      expect(errors.some((e) => e.includes("parentScope.idParam"))).toBe(true);
    });
  });
});
