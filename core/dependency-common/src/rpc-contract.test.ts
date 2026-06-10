import { describe, expect, test } from "bun:test";
import type { ProcedureMetadata } from "@checkstack/common";
import { dependencyContract } from "./rpc-contract";

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
  // createDependency / updateDependency / deleteDependency — existing wiring
  // -------------------------------------------------------------------------
  describe("createDependency (existing wiring — regression guard)", () => {
    test("carries instanceAccess.idParam = 'sourceSystemId'", () => {
      const meta = metaFor("createDependency");
      expect(meta.instanceAccess).toEqual({ idParam: "sourceSystemId" });
    });
  });

  describe("updateDependency (existing wiring — regression guard)", () => {
    test("carries instanceAccess.idParam = 'systemId'", () => {
      const meta = metaFor("updateDependency");
      expect(meta.instanceAccess).toEqual({ idParam: "systemId" });
    });
  });

  describe("deleteDependency (existing wiring — regression guard)", () => {
    test("carries instanceAccess.idParam = 'systemId'", () => {
      const meta = metaFor("deleteDependency");
      expect(meta.instanceAccess).toEqual({ idParam: "systemId" });
    });
  });
});
