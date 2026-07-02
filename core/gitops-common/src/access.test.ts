import { describe, expect, test } from "bun:test";
import type { ProcedureMetadata } from "@checkstack/common";
import { gitopsAccess, gitopsAccessRules } from "./access";
import { gitopsContract } from "./rpc-contract";

function metaFor(procName: keyof typeof gitopsContract): ProcedureMetadata {
  const procedure = gitopsContract[procName] as unknown as Record<
    string,
    unknown
  >;
  const orpc = procedure["~orpc"] as { meta?: ProcedureMetadata } | undefined;
  if (!orpc?.meta) throw new Error(`${String(procName)} has no meta`);
  return orpc.meta;
}

/**
 * Guards the GitOps default-access policy: regular users must NOT see the
 * GitOps page by default (`provider.read` / `secret.read` are not defaults),
 * while the provenance-lock primitives every editor relies on stay on the
 * DEFAULT `provenance.read` rule - splitting them off `provider.read` is what
 * keeps editor lock indicators working when the page is admin-gated.
 */
describe("gitops default-access policy", () => {
  test("provider.read and secret.read are NOT defaults (page is admin-granted)", () => {
    expect(gitopsAccess.provider.read.isDefault).toBeFalsy();
    expect(gitopsAccess.secret.read.isDefault).toBeFalsy();
  });

  test("provenance.read IS a default (editor lock indicators keep working)", () => {
    expect(gitopsAccess.provenance.read.isDefault).toBe(true);
  });

  test("provenance.read is registered with the plugin system", () => {
    expect(gitopsAccessRules).toContain(gitopsAccess.provenance.read);
  });

  for (const procName of ["getProvenance", "listProvenance"] as const) {
    test(`${procName} is gated on provenance.read, not provider.read`, () => {
      const accessIds = (metaFor(procName).access ?? []).map((r) => r.id);
      expect(accessIds).toEqual([gitopsAccess.provenance.read.id]);
    });
  }
});
