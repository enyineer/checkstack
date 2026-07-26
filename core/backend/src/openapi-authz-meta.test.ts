import { describe, it, expect } from "bun:test";
import type { AnyContractRouter } from "@orpc/contract";
import { access, type AccessRule, type InstanceAccessConfig } from "@checkstack/common";
import { buildMetadataLookup } from "./openapi-router";

/**
 * Guards the doc-generation WIRING: the OpenAPI metadata lookup must read a
 * procedure's `access` AND `instanceAccess` and surface a full `authorization`
 * spec - so the API docs describe the real (team-grant / per-object) rule, not
 * just the flat global one. The spec CONTENT is unit-tested in
 * `@checkstack/common`'s access-modes.test.ts; here we only prove it is emitted.
 */
function fakeContracts(
  procs: Record<
    string,
    {
      pluginId: string;
      userType?: string;
      access?: AccessRule[];
      instanceAccess?: InstanceAccessConfig;
    }
  >,
): Map<string, AnyContractRouter> {
  const byPlugin = new Map<string, Record<string, unknown>>();
  for (const [name, { pluginId, ...meta }] of Object.entries(procs)) {
    const contract = byPlugin.get(pluginId) ?? {};
    contract[name] = { "~orpc": { meta } };
    byPlugin.set(pluginId, contract);
  }
  const out = new Map<string, AnyContractRouter>();
  for (const [pluginId, contract] of byPlugin) {
    out.set(pluginId, contract as unknown as AnyContractRouter);
  }
  return out;
}

const rule = (
  resource: string,
  level: "read" | "manage",
  pluginId: string,
): AccessRule => access(resource, level, `${resource} ${level}`, { pluginId });

describe("openapi authorization metadata", () => {
  it("surfaces the per-object authorization for an objectRef endpoint (not 'no restriction')", () => {
    const lookup = buildMetadataLookup(
      fakeContracts({
        writeRelation: {
          pluginId: "auth",
          userType: "authenticated",
          access: [rule("teams", "manage", "auth")],
          instanceAccess: {
            objectRef: { typeParam: "objectType", idParam: "objectId", action: "manage" },
          },
        },
      }),
    );

    const meta = lookup.get("auth.writeRelation");
    expect(meta).toBeDefined();
    expect(meta?.accessRules).toEqual(["auth.teams.manage"]);
    expect(meta?.authorization?.globalRules).toEqual(["auth.teams.manage"]);
    expect(meta?.authorization?.instance[0]?.mode).toBe("objectRef");
    expect(meta?.authorization?.summary).toContain("`objectType`/`objectId`");
  });

  it("surfaces the team-grant dimension for an idParam endpoint", () => {
    const lookup = buildMetadataLookup(
      fakeContracts({
        getSystem: {
          pluginId: "catalog",
          userType: "authenticated",
          access: [{ ...rule("system", "read", "catalog"), instanceAccess: { idParam: "systemId" } }],
        },
      }),
    );

    const meta = lookup.get("catalog.getSystem");
    expect(meta?.authorization?.instance[0]?.mode).toBe("idParam");
    expect(meta?.authorization?.summary).toContain("team read grant on the catalog.system");
  });

  it("still emits an authorization spec for a plain global-only endpoint", () => {
    const lookup = buildMetadataLookup(
      fakeContracts({
        listRoles: {
          pluginId: "auth",
          userType: "authenticated",
          access: [rule("roles", "read", "auth")],
        },
      }),
    );
    const meta = lookup.get("auth.listRoles");
    expect(meta?.authorization?.globalRules).toEqual(["auth.roles.read"]);
    expect(meta?.authorization?.instance).toEqual([]);
  });
});
