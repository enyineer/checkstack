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

  test("createGroup does NOT carry instanceAccess.create (groups are global)", () => {
    const meta = metaFor("createGroup");
    expect(meta.instanceAccess?.create).toBeUndefined();
  });
});

/**
 * Global resources (groups, environments, views) must NOT gain per-system
 * scoping. getEntities additionally returns a `groups` array that is global by
 * design and must never be filtered. These guards stop an over-correction.
 */
describe("catalog global resources stay unscoped", () => {
  // Groups and views carry no instanceAccess at all (no team-based scoping).
  const noAccessProcs: Array<keyof typeof catalogContract> = [
    "getGroups",
    "createGroup",
    "updateGroup",
    "deleteGroup",
    "getViews",
    "createView",
  ];

  for (const procName of noAccessProcs) {
    test(`${String(procName)} carries no instanceAccess override`, () => {
      expect(metaFor(procName).instanceAccess).toBeUndefined();
    });
  }

  // Environments are instance-wide global primitives — they carry
  // `instanceAccess: { global: true }` to signal to the middleware that
  // no team-based scoping applies (as opposed to simply being absent).
  const globalTrueProcs: Array<keyof typeof catalogContract> = [
    "listEnvironments",
    "getEnvironment",
    "createEnvironment",
    "updateEnvironment",
    "deleteEnvironment",
  ];

  for (const procName of globalTrueProcs) {
    test(`${String(procName)} carries instanceAccess { global: true }`, () => {
      expect(metaFor(procName).instanceAccess).toEqual({ global: true });
    });
  }
});
