import { describe, expect, it } from "bun:test";
import { Glob } from "bun";
import path from "node:path";
import type { AnyContractRouter } from "@orpc/contract";
import { validateContractInstanceAccess } from "./plugin-loader";

/**
 * Whole-repo conformance for the REAL RPC contracts (the boot-time validator's
 * unit tests use synthetic contracts). Two guarantees the per-contract boot
 * validator cannot give on its own:
 *
 *  1. Every shipped `*-common` contract is boot-valid - i.e. no procedure would
 *     trip `validateContractInstanceAccess` when the plugin manager loads it
 *     (empty/multiple modes, fail-open on a scopable type, an idParam that
 *     names no input field, a malformed parentScope).
 *
 *  2. Cross-contract parent-type integrity: a `parentScope.resourceType` (or
 *     `create.parent.resourceType`) names a type that is ACTUALLY team-scoped by
 *     some contract in the repo. The boot validator only sees ONE contract, so a
 *     parent that lives in another plugin (e.g. healthcheck's `associateSystem`
 *     scoping on `catalog.system`) can be typo'd to a dangling type and still
 *     pass boot - then every team grant check against it fails closed forever.
 *     This mirrors the frontend guard in `scripts/check-manage-capabilities.ts`.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const CONTRACT_GLOBS = [
  "core/*-common/src/rpc-contract.ts",
  "plugins/*-common/src/rpc-contract.ts",
];

interface InstanceAccess {
  global?: boolean;
  idParam?: string;
  listKey?: string;
  recordKey?: string;
  create?: {
    parent?: { resourceType?: string };
    alsoAcceptCreatorOf?: string[];
  };
  parentScope?: { resourceType?: string };
}
interface ProcMeta {
  access?: Array<{ resource: string; pluginId: string }>;
  instanceAccess?: InstanceAccess;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function procMeta(proc: unknown): ProcMeta | undefined {
  if (!isRecord(proc)) return undefined;
  const orpc = proc["~orpc"];
  if (!isRecord(orpc)) return undefined;
  return isRecord(orpc.meta) ? (orpc.meta as ProcMeta) : undefined;
}

/** A contract export is a plain object whose values are procs with meta. */
function asContract(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || Array.isArray(value)) return undefined;
  const procs = Object.values(value);
  return procs.some((p) => procMeta(p)) ? (value as Record<string, unknown>) : undefined;
}

async function collectContracts(): Promise<
  Array<{ file: string; pluginId: string; contract: Record<string, unknown> }>
> {
  const found: Array<{
    file: string;
    pluginId: string;
    contract: Record<string, unknown>;
  }> = [];
  for (const pattern of CONTRACT_GLOBS) {
    for await (const file of new Glob(pattern).scan({ cwd: REPO_ROOT })) {
      const mod = (await import(path.resolve(REPO_ROOT, file))) as Record<
        string,
        unknown
      >;
      for (const exported of Object.values(mod)) {
        const contract = asContract(exported);
        if (!contract) continue;
        // pluginId only labels error messages; the access rules carry it.
        const firstMeta = Object.values(contract)
          .map((p) => procMeta(p))
          .find((m) => m?.access?.length);
        const pluginId = firstMeta?.access?.[0]?.pluginId ?? file;
        found.push({ file, pluginId, contract });
      }
    }
  }
  return found;
}

const contracts = await collectContracts();

// The authoritative team-scopable set: every type a contract keys real grants
// on. Derived exactly like the RPC middleware / the frontend guard: a scoping
// mode (idParam/listKey/recordKey/create, NOT `{ global: true }`) marks each of
// its access-rule types scopable; a parentScope marks its parent type.
const teamScopableTypes = new Set<string>();
for (const { contract } of contracts) {
  for (const proc of Object.values(contract)) {
    const meta = procMeta(proc);
    const ia = meta?.instanceAccess;
    if (!ia || ia.global === true) continue;
    if (ia.parentScope?.resourceType) {
      teamScopableTypes.add(ia.parentScope.resourceType);
      continue;
    }
    for (const rule of meta?.access ?? []) {
      teamScopableTypes.add(`${rule.pluginId}.${rule.resource}`);
    }
  }
}

describe("RPC contract instanceAccess conformance (whole repo)", () => {
  it("discovers the shipped contracts", () => {
    // Guard against a broken glob silently asserting nothing.
    expect(contracts.length).toBeGreaterThan(5);
    expect(teamScopableTypes.size).toBeGreaterThan(5);
  });

  it("every shipped contract is boot-valid (validateContractInstanceAccess)", () => {
    const validationErrors: string[] = [];
    for (const { pluginId, contract } of contracts) {
      validateContractInstanceAccess({
        pluginId,
        // The real contract satisfies the shape the validator reads; the cast
        // matches the sibling unit test's faker (validator only reads ~orpc.meta).
        contract: contract as unknown as AnyContractRouter,
        validationErrors,
      });
    }
    expect(validationErrors).toEqual([]);
  });

  it("every parentScope / create.parent / create.alsoAcceptCreatorOf resourceType is team-scoped somewhere", () => {
    const danglers: string[] = [];
    for (const { file, contract } of contracts) {
      for (const [name, proc] of Object.entries(contract)) {
        const ia = procMeta(proc)?.instanceAccess;
        const parents = [
          ia?.parentScope?.resourceType,
          ia?.create?.parent?.resourceType,
          // A sibling create-gate type MUST also be a real scoped type, or its
          // `creator` grant could never be granted and the gate is dead.
          ...(ia?.create?.alsoAcceptCreatorOf ?? []),
        ].filter((t): t is string => typeof t === "string");
        for (const parent of parents) {
          if (!teamScopableTypes.has(parent)) {
            danglers.push(`${file} :: ${name} -> parent "${parent}"`);
          }
        }
      }
    }
    // A dangling parent/sibling type means the grant check keys on a type no
    // contract team-scopes, so it fails closed forever. Print the offenders.
    expect(danglers).toEqual([]);
  });
});
