import { describe, expect, test } from "bun:test";
import type { ProcedureMetadata } from "@checkstack/common";
import { dependencyContract } from "./rpc-contract";
import { dependencyAccess } from "./access";

/**
 * Reads the oRPC meta block from a contract procedure.
 *
 * oRPC bakes metadata into the `["~orpc"].meta` property at build time;
 * `autoAuthMiddleware` reads the same path at runtime to enforce access rules.
 * These tests assert that each procedure carries the expected `instanceAccess`
 * config so the middleware will apply the correct scoping strategy.
 */
function metaFor(procName: keyof typeof dependencyContract): ProcedureMetadata {
  const procedure = dependencyContract[procName] as unknown as Record<
    string,
    unknown
  >;
  const orpc = procedure["~orpc"] as { meta?: ProcedureMetadata } | undefined;
  if (!orpc?.meta) throw new Error(`${String(procName)} has no meta`);
  return orpc.meta;
}

describe("dependencyContract instanceAccess wiring", () => {
  // -------------------------------------------------------------------------
  // getWarnings — bulk record endpoint; keys ARE systemIds
  // -------------------------------------------------------------------------
  describe("getWarnings", () => {
    test("carries instanceAccess.recordKey = 'warnings'", () => {
      const meta = metaFor("getWarnings");
      expect(meta.instanceAccess).toEqual({ recordKey: "warnings" });
    });

    test("does not carry idParam (would clash with recordKey semantics)", () => {
      const meta = metaFor("getWarnings");
      expect(meta.instanceAccess?.idParam).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getWarningsForSystem — single-system endpoint, input has systemId
  // -------------------------------------------------------------------------
  describe("getWarningsForSystem", () => {
    test("carries instanceAccess.idParam = 'systemId'", () => {
      const meta = metaFor("getWarningsForSystem");
      expect(meta.instanceAccess).toEqual({ idParam: "systemId" });
    });

    test("does not carry recordKey or listKey", () => {
      const meta = metaFor("getWarningsForSystem");
      expect(meta.instanceAccess?.recordKey).toBeUndefined();
      expect(meta.instanceAccess?.listKey).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getDependencies — already wired; regression guard
  // -------------------------------------------------------------------------
  describe("getDependencies (existing wiring — regression guard)", () => {
    test("carries instanceAccess.idParam = 'systemId'", () => {
      const meta = metaFor("getDependencies");
      expect(meta.instanceAccess).toEqual({ idParam: "systemId" });
    });
  });

  // -------------------------------------------------------------------------
  // getAllDependencies — global topology map, intentionally unscoped
  // -------------------------------------------------------------------------
  describe("getAllDependencies (intentionally unscoped)", () => {
    test("carries no instanceAccess (full topology, map-rule gated)", () => {
      const meta = metaFor("getAllDependencies");
      expect(meta.instanceAccess).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // The map is authenticated-only BY CONSTRUCTION: a rule is anonymous-usable
  // iff at least one proc requiring it is `public` (plugin-manager's
  // getAnonymousUsableAccessRuleIds). If any map-gated proc regresses to
  // `public`, `dependency.map.read` becomes grantable to the anonymous role
  // and the full system topology leaks to guests.
  // -------------------------------------------------------------------------
  describe("map-rule procs are never public (anonymous cannot hold the map rule)", () => {
    const procNames = Object.keys(dependencyContract) as Array<
      keyof typeof dependencyContract
    >;

    test("every proc requiring dependency.map is a non-public userType", () => {
      const mapGated = procNames.filter((name) =>
        metaFor(name).access?.some(
          (rule) => rule.id === dependencyAccess.map.id,
        ),
      );
      // Guard the guard: the known map procs must actually be found, or the
      // filter itself has gone stale.
      expect(mapGated).toEqual(
        expect.arrayContaining([
          "getAllDependencies",
          "getNodePositions",
          "saveNodePositions",
        ]),
      );
      for (const name of mapGated) {
        expect(metaFor(name).userType).not.toBe("public");
        expect(metaFor(name).userType).not.toBe("anonymous");
      }
    });

    test("getAllDependencies stays 'authenticated' (users AND application principals for the AI projection)", () => {
      expect(metaFor("getAllDependencies").userType).toBe("authenticated");
    });
  });

  // -------------------------------------------------------------------------
  // createDependency / updateDependency / deleteDependency — writes are
  // authorized by MANAGE on the SOURCE system (catalog.system parentScope), NOT
  // by a `dependency` grant keyed by the system id (which never exists and
  // denied every team-scoped user). The target system is not access-checked.
  // -------------------------------------------------------------------------
  describe("createDependency parent-scopes on the source system", () => {
    test("carries parentScope catalog.system manage on 'sourceSystemId'", () => {
      const meta = metaFor("createDependency");
      expect(meta.instanceAccess).toEqual({
        parentScope: {
          resourceType: "catalog.system",
          action: "manage",
          idParam: "sourceSystemId",
        },
      });
    });
  });

  describe("updateDependency parent-scopes on the source system", () => {
    test("carries parentScope catalog.system manage on 'systemId'", () => {
      const meta = metaFor("updateDependency");
      expect(meta.instanceAccess).toEqual({
        parentScope: {
          resourceType: "catalog.system",
          action: "manage",
          idParam: "systemId",
        },
      });
    });
  });

  describe("deleteDependency parent-scopes on the source system", () => {
    test("carries parentScope catalog.system manage on 'systemId'", () => {
      const meta = metaFor("deleteDependency");
      expect(meta.instanceAccess).toEqual({
        parentScope: {
          resourceType: "catalog.system",
          action: "manage",
          idParam: "systemId",
        },
      });
    });
  });
});
