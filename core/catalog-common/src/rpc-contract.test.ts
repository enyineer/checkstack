import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { catalogContract } from "./rpc-contract";

/**
 * Contract-level guards for the fuzzing-pass findings:
 * - `getSystemContacts` leaked PII (userId/userName/userEmail) to anonymous
 *   callers because it was `userType: "public"`. It must be `authenticated`.
 * - System/Group names were bare `z.string()`, so empty, whitespace-only, and
 *   100KB+ names reached the DB (the huge ones surfaced as 500s).
 *
 * `~orpc` is the contract-procedure internals (same accessor the sandbox-policy
 * access test uses); `meta.userType` and `inputSchema` are stable fields on it.
 */
interface InstanceAccessCreateMode {
  teamIdParam?: string;
  idField?: string;
  alsoAcceptCreatorOf?: string[];
}

interface InstanceAccessParentScope {
  resourceType?: string;
  action?: "read" | "manage";
  idParam?: string;
  recordKey?: string;
}

interface InstanceAccessMeta {
  idParam?: string;
  listKey?: string;
  recordKey?: string;
  global?: boolean;
  create?: InstanceAccessCreateMode;
  parentScope?: InstanceAccessParentScope;
}

function metaFor(procName: keyof typeof catalogContract): {
  userType?: string;
  instanceAccess?: InstanceAccessMeta;
} {
  const proc = catalogContract[procName] as unknown as Record<string, unknown>;
  const orpc = proc["~orpc"] as {
    meta?: { userType?: string; instanceAccess?: InstanceAccessMeta };
  };
  return orpc.meta ?? {};
}

function inputSchemaFor(procName: keyof typeof catalogContract): ZodType {
  const proc = catalogContract[procName] as unknown as Record<string, unknown>;
  const orpc = proc["~orpc"] as { inputSchema?: ZodType };
  if (!orpc.inputSchema) throw new Error(`${String(procName)} has no input`);
  return orpc.inputSchema;
}

describe("getSystemContacts is gated to authenticated callers (PII)", () => {
  test("userType is authenticated, not public", () => {
    expect(metaFor("getSystemContacts").userType).toBe("authenticated");
  });

  test("anonymous-readable catalog reads stay public (no over-correction)", () => {
    expect(metaFor("getEntities").userType).toBe("public");
    expect(metaFor("getSystem").userType).toBe("public");
  });
});

describe("catalog name validation", () => {
  const cases: Array<keyof typeof catalogContract> = [
    "createSystem",
    "createGroup",
  ];

  for (const procName of cases) {
    test(`${String(procName)} rejects an empty name`, () => {
      expect(inputSchemaFor(procName).safeParse({ name: "" }).success).toBe(
        false,
      );
    });

    test(`${String(procName)} rejects a whitespace-only name`, () => {
      expect(inputSchemaFor(procName).safeParse({ name: "   " }).success).toBe(
        false,
      );
    });

    test(`${String(procName)} rejects a name over 200 chars`, () => {
      expect(
        inputSchemaFor(procName).safeParse({ name: "a".repeat(201) }).success,
      ).toBe(false);
    });

    test(`${String(procName)} trims a valid name`, () => {
      const parsed = inputSchemaFor(procName).safeParse({ name: "  ok  " });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect((parsed.data as { name: string }).name).toBe("ok");
      }
    });
  }

  test("updateSystem rejects a whitespace-only name when provided", () => {
    const schema = inputSchemaFor("updateSystem");
    expect(
      schema.safeParse({ id: "s1", data: { name: "   " } }).success,
    ).toBe(false);
    // ...but omitting the name (partial update) is still allowed.
    expect(schema.safeParse({ id: "s1", data: {} }).success).toBe(true);
  });
});

/**
 * Team-scoping regression guards. Grants for catalog systems are keyed by
 * `resourceType="catalog.system"`, `resourceId={system.id}` (see the frontend
 * `TeamAccessEditor` in SystemEditor.tsx). The autoAuthMiddleware reads each
 * proc's `instanceAccess` (a per-proc `meta.instanceAccess` override wins over
 * the access rule's). For per-system enforcement to actually fire, `idParam`
 * MUST resolve to a real input field whose value is the system id used in
 * grants. These tests pin the corrected keying so the G9 "mutating a system
 * skips the per-system check" class of bug cannot regress.
 */
describe("catalog system-scoped mutations carry the right instanceAccess", () => {
  // Keystone (G9): a system is targeted by its OWN id. updateSystem takes
  // `{ id, data }` and deleteSystem `{ id }`, so the per-proc override must
  // key on `id` (the rule's default `systemId` would never match the input).
  test("updateSystem keys the per-system check on its `id` input field", () => {
    expect(metaFor("updateSystem").instanceAccess).toEqual({ idParam: "id" });
  });

  test("deleteSystem keys the per-system check on its `id` input field", () => {
    expect(metaFor("deleteSystem").instanceAccess).toEqual({ idParam: "id" });
    // Input must be a named object so `idParam` has a field to read.
    expect(inputSchemaFor("deleteSystem").safeParse({ id: "s1" }).success).toBe(
      true,
    );
    expect(inputSchemaFor("deleteSystem").safeParse("s1").success).toBe(false);
  });

  // Sub-resource mutations are scoped by their PARENT system, so `idParam`
  // points at the `systemId` field (grants are keyed on "catalog.system").
  const systemIdScoped: Array<keyof typeof catalogContract> = [
    "addSystemContact",
    "removeSystemContact",
    "addSystemLink",
    "removeSystemLink",
    "addSystemToGroup",
    "removeSystemFromGroup",
  ];

  for (const procName of systemIdScoped) {
    test(`${String(procName)} keys the per-system check on \`systemId\``, () => {
      expect(metaFor(procName).instanceAccess).toEqual({ idParam: "systemId" });
      // The input must actually carry a `systemId` field for the check to
      // fire: an input that omits it must fail validation.
      const schema = inputSchemaFor(procName);
      expect(schema.safeParse({}).success).toBe(false);
    });
  }

  test("removeSystemContact input carries both id and systemId", () => {
    const schema = inputSchemaFor("removeSystemContact");
    expect(schema.safeParse({ id: "c1", systemId: "s1" }).success).toBe(true);
    expect(schema.safeParse("c1").success).toBe(false);
  });

  test("removeSystemLink input carries both id and systemId", () => {
    const schema = inputSchemaFor("removeSystemLink");
    expect(schema.safeParse({ id: "l1", systemId: "s1" }).success).toBe(true);
    expect(schema.safeParse("l1").success).toBe(false);
  });

  // setSystemEnvironments is scoped via parentScope (not a plain idParam) so
  // catalog.environment stays non-scopable. Manage access on the parent system.
  test("setSystemEnvironments carries parentScope { resourceType: 'catalog.system', action: 'manage', idParam: 'systemId' }", () => {
    expect(metaFor("setSystemEnvironments").instanceAccess).toEqual({
      parentScope: {
        resourceType: "catalog.system",
        action: "manage",
        idParam: "systemId",
      },
    });
  });

  // getSystemEnvironments is scoped via parentScope (read action on parent system).
  test("getSystemEnvironments carries parentScope { resourceType: 'catalog.system', action: 'read', idParam: 'systemId' }", () => {
    expect(metaFor("getSystemEnvironments").instanceAccess).toEqual({
      parentScope: {
        resourceType: "catalog.system",
        action: "read",
        idParam: "systemId",
      },
    });
  });

  // Single-system reads are scoped by `systemId` (matching their input field).
  const systemReadScoped: Array<keyof typeof catalogContract> = [
    "getSystem",
    "getSystemContacts",
    "getSystemLinks",
    "getSystemGroups",
  ];

  for (const procName of systemReadScoped) {
    test(`${String(procName)} keys the per-system read on \`systemId\``, () => {
      expect(metaFor(procName).instanceAccess).toEqual({ idParam: "systemId" });
    });
  }

  // List reads filter the `systems` output array (each item has `.id` = the
  // system id used in grants). Both procs carry a proc-level `listKey` override
  // so the middleware knows which array to filter without re-reading the rule.
  test("getSystems carries instanceAccess { listKey: 'systems' }", () => {
    expect(metaFor("getSystems").instanceAccess).toEqual({ listKey: "systems" });
  });

  test("getEntities carries instanceAccess { listKey: 'systems' }", () => {
    expect(metaFor("getEntities").instanceAccess).toEqual({
      listKey: "systems",
    });
  });

  /**
   * CREATE-MODE team ownership regression guard.
   *
   * `createSystem` opts into the autoAuthMiddleware's create-mode by declaring
   * `instanceAccess.create`. The middleware reads `input.teamId` (teamIdParam)
   * to resolve the owning team and writes the ownership grant keyed by
   * `catalog.system` / `response.id` (idField). These assertions pin the exact
   * shape so a refactor cannot silently drop the wiring.
   */
  test("createSystem carries instanceAccess.create with teamIdParam 'teamId' and idField 'id'", () => {
    const meta = metaFor("createSystem");
    expect(meta.instanceAccess?.create).toEqual({
      teamIdParam: "teamId",
      idField: "id",
    });
  });

  test("createSystem input accepts an optional teamId field", () => {
    const schema = inputSchemaFor("createSystem");
    // With teamId — must be valid
    expect(
      schema.safeParse({ name: "My System", teamId: "team-abc" }).success,
    ).toBe(true);
    // Without teamId — still valid (backward-compatible)
    expect(schema.safeParse({ name: "My System" }).success).toBe(true);
    // teamId must be a string when provided
    expect(
      schema.safeParse({ name: "My System", teamId: 42 }).success,
    ).toBe(false);
  });

  // Groups and environments are now team-manageable: create carries create-mode
  // with `alsoAcceptCreatorOf: ["catalog.system"]` so a system creator may also
  // create them.
  for (const procName of ["createGroup", "createEnvironment"] as const) {
    test(`${procName} carries create-mode with the catalog.system sibling gate`, () => {
      expect(metaFor(procName).instanceAccess?.create).toEqual({
        teamIdParam: "teamId",
        idField: "id",
        alsoAcceptCreatorOf: ["catalog.system"],
      });
    });

    test(`${procName} input accepts an optional teamId field`, () => {
      const schema = inputSchemaFor(procName);
      expect(schema.safeParse({ name: "X", teamId: "team-1" }).success).toBe(
        true,
      );
      expect(schema.safeParse({ name: "X" }).success).toBe(true);
      expect(schema.safeParse({ name: "X", teamId: 42 }).success).toBe(false);
    });
  }
});

/**
 * Groups and environments became team-manageable: their WRITES are team-scoped
 * (create-mode owner grant + per-instance manage), while their READS stay public
 * (shared browse facets). These guards pin the new wiring so it cannot regress to
 * global-only. Views remain global.
 */
describe("catalog group & environment writes are team-scoped, reads stay public", () => {
  // Per-instance manage: update/delete key on the resource's own id.
  test("updateGroup keys the per-group manage on its `id` field", () => {
    expect(metaFor("updateGroup").instanceAccess).toEqual({ idParam: "id" });
  });

  test("deleteGroup keys the per-group manage on `id` and takes a named { id } input", () => {
    expect(metaFor("deleteGroup").instanceAccess).toEqual({ idParam: "id" });
    expect(inputSchemaFor("deleteGroup").safeParse({ id: "g1" }).success).toBe(
      true,
    );
    // Reshaped from a bare string so `idParam` has a field to read.
    expect(inputSchemaFor("deleteGroup").safeParse("g1").success).toBe(false);
  });

  test("updateEnvironment / deleteEnvironment key the per-env manage on `environmentId`", () => {
    expect(metaFor("updateEnvironment").instanceAccess).toEqual({
      idParam: "environmentId",
    });
    expect(metaFor("deleteEnvironment").instanceAccess).toEqual({
      idParam: "environmentId",
    });
  });

  // Reads stay public: the list/get facets carry `global: true` (the deliberate
  // "not team-filtered" marker) so team-scoped users still see every group/env.
  const publicReadProcs: Array<keyof typeof catalogContract> = [
    "getGroups",
    "listEnvironments",
    "getEnvironment",
  ];
  for (const procName of publicReadProcs) {
    test(`${String(procName)} read stays public (global: true, not team-filtered)`, () => {
      expect(metaFor(procName).instanceAccess).toEqual({ global: true });
    });
  }

  // reorderGroups rewrites the single global sort column, so it stays a
  // global-admin op (global: true), NOT a per-instance write.
  test("reorderGroups stays global-admin (global: true)", () => {
    expect(metaFor("reorderGroups").instanceAccess).toEqual({ global: true });
  });

  // Views remain global (no team scoping) — no instanceAccess override.
  for (const procName of ["getViews", "createView"] as const) {
    test(`${procName} stays global (no instanceAccess override)`, () => {
      expect(metaFor(procName).instanceAccess).toBeUndefined();
    });
  }
});
