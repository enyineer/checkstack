import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { qualifyResourceType } from "@checkstack/common";
import { healthCheckContract } from "./rpc-contract";
import { healthCheckAccess, healthCheckResourceTypes } from "./access";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Guards the REST-compatibility fix: history date params were `z.date()`, which
 * a `/rest/...` string param can never satisfy, so every REST history call
 * 400'd. `z.coerce.date()` accepts both the REST string shape and the native RPC
 * Date shape.
 */
function inputSchemaFor(procName: keyof typeof healthCheckContract): ZodType {
  const proc = healthCheckContract[procName] as unknown as Record<
    string,
    unknown
  >;
  const orpc = proc["~orpc"] as { inputSchema?: ZodType };
  if (!orpc.inputSchema) throw new Error(`${String(procName)} has no input`);
  return orpc.inputSchema;
}

interface InstanceAccessMeta {
  idParam?: string;
  listKey?: string;
  recordKey?: string;
  create?: { teamIdParam?: string; idField?: string };
  parentScope?: {
    resourceType?: string;
    action?: string;
    idParam?: string;
    recordKey?: string;
  };
}

function metaFor(procName: keyof typeof healthCheckContract): {
  userType?: string;
  access?: unknown[];
  instanceAccess?: InstanceAccessMeta;
} {
  const proc = healthCheckContract[procName] as unknown as Record<
    string,
    unknown
  >;
  const orpc = proc["~orpc"] as {
    meta?: {
      userType?: string;
      access?: unknown[];
      instanceAccess?: InstanceAccessMeta;
    };
  };
  return orpc.meta ?? {};
}

describe("history endpoints coerce string date params (REST compatibility)", () => {
  test("getAggregatedHistory accepts ISO date strings", () => {
    const parsed = inputSchemaFor("getAggregatedHistory").safeParse({
      systemId: "sys-1",
      configurationId: "cfg-1",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-02-01T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as { startDate: Date };
      expect(data.startDate).toBeInstanceOf(Date);
    }
  });

  test("getHistory accepts ISO date strings on its optional date params", () => {
    const parsed = inputSchemaFor("getHistory").safeParse({
      systemId: "sys-1",
      startDate: "2026-01-01T00:00:00.000Z",
      sortOrder: "desc",
    });
    expect(parsed.success).toBe(true);
  });
});

/**
 * Team-scoping regression guards. Grants for health-check configurations are
 * keyed by `resourceType="healthcheck.healthcheck"` (NOT
 * `"healthcheck.configuration"`), `resourceId={configId}`. The keying is derived
 * by the RPC middleware from the configuration access rule's `resource`
 * (`accessPair("healthcheck", ...)` => `qualifyResourceType(pluginId,
 * "healthcheck")` => `healthcheck.healthcheck`), and MUST equal
 * `healthCheckResourceTypes.configuration` so the frontend capability gate and
 * the Teams grant-name resolver look up the same rows the middleware writes (see
 * the pinned assertion below). The autoAuthMiddleware reads each proc's
 * `instanceAccess` (a per-proc `meta.instanceAccess` override wins over the
 * access rule's). For per-config enforcement to fire, `idParam`/`listKey`(item.id)
 * MUST resolve to the configuration id used in grants. These tests pin both the
 * keying and the resource type so the "mutating a config skips the per-config
 * check" and "frontend gate checks a type the backend never writes" classes of
 * bug cannot regress.
 */
describe("healthcheck configuration-scoped procs carry the right instanceAccess", () => {
  test("the configuration capability type matches the middleware's grant key", () => {
    // The RPC middleware keys per-config team grants on
    // `qualifyResourceType(pluginId, rule.resource)` for the configuration
    // MANAGE rule. `healthCheckResourceTypes.configuration` (used by the frontend
    // capability gate, the route `manageCapability`, and the Teams resolver) MUST
    // equal that exact key, or a team-scoped health-check manager silently sees
    // no management surface and grant names never resolve. This pins the two
    // sides together so the divergence fixed here cannot regress.
    const middlewareGrantKey = qualifyResourceType(
      pluginMetadata.pluginId,
      healthCheckAccess.configuration.manage.resource,
    );
    expect(middlewareGrantKey).toBe(healthCheckResourceTypes.configuration);
    // Pin the literal too (the constant is a branded ResourceType; compare via
    // the plain-string middleware key so the brand doesn't reject the literal).
    expect(middlewareGrantKey).toBe("healthcheck.healthcheck");
  });

  test("getConfigurations filters its `configurations` list by item id", () => {
    expect(metaFor("getConfigurations").instanceAccess).toEqual({
      listKey: "configurations",
    });
  });

  test("getConfiguration is handler-authorized (empty access, no declarative scoping)", () => {
    // Deliberately NOT `idParam: "id"`: the read is authorized in the router
    // via `assignment-access.ts` (global read, a team grant on the config, OR
    // read access to an ASSIGNED system) - an OR over a parent relation the
    // declarative modes cannot express. An empty `access` with no
    // instanceAccess means the middleware enforces nothing, so this pin
    // exists to catch both regressions: "tidying" the proc back to idParam
    // (which locks pure system managers out of the editor) and adding a rule
    // without keeping the handler-side authorization.
    expect(metaFor("getConfiguration").access).toEqual([]);
    expect(metaFor("getConfiguration").instanceAccess).toBeUndefined();
  });

  test("getConfigurationAssignments is handler-authorized (empty access, no declarative scoping)", () => {
    // Same reasoning as getConfiguration: rows are keyed by systemId while
    // the grant anchors on the configuration, so the router filters rows via
    // `assignment-access.ts` (fail-closed) instead of a declarative mode.
    expect(metaFor("getConfigurationAssignments").access).toEqual([]);
    expect(
      metaFor("getConfigurationAssignments").instanceAccess,
    ).toBeUndefined();
  });

  test("updateConfiguration keys the per-config check on its `id` input field", () => {
    expect(metaFor("updateConfiguration").instanceAccess).toEqual({
      idParam: "id",
    });
    // Input must carry both `id` and `body`.
    expect(
      inputSchemaFor("updateConfiguration").safeParse({
        id: "cfg-1",
        body: {},
      }).success,
    ).toBe(true);
  });

  // These were reshaped from a bare `z.string()` to `{ id }` so the middleware
  // can read `input.id`. The bare-string form must now be rejected.
  const idObjectScoped: Array<keyof typeof healthCheckContract> = [
    "deleteConfiguration",
    "pauseConfiguration",
    "resumeConfiguration",
  ];

  for (const procName of idObjectScoped) {
    test(`${String(procName)} keys the per-config check on \`id\` and takes \`{ id }\``, () => {
      expect(metaFor(procName).instanceAccess).toEqual({ idParam: "id" });
      const schema = inputSchemaFor(procName);
      expect(schema.safeParse({ id: "cfg-1" }).success).toBe(true);
      // Breaking input reshape: a bare string id no longer validates.
      expect(schema.safeParse("cfg-1").success).toBe(false);
    });
  }
});

/**
 * Create-mode guard: a team member holding a create-capability grant may
 * create a config and have the owning-team grant written for the returned id.
 * The proc opts in via `instanceAccess.create`, and the input gains an
 * OPTIONAL `teamId` (existing callers omit it harmlessly).
 */
describe("healthcheck createConfiguration is wired for create-mode team ownership", () => {
  test("carries instanceAccess.create keyed on teamId/id", () => {
    expect(metaFor("createConfiguration").instanceAccess).toEqual({
      create: { teamIdParam: "teamId", idField: "id" },
    });
  });

  const validCreate = {
    name: "my check",
    strategyId: "http",
    config: {},
    intervalSeconds: 60,
  };

  test("accepts a create payload WITHOUT teamId (backward compatible)", () => {
    expect(
      inputSchemaFor("createConfiguration").safeParse(validCreate).success,
    ).toBe(true);
  });

  test("accepts an optional teamId", () => {
    const parsed = inputSchemaFor("createConfiguration").safeParse({
      ...validCreate,
      teamId: "team-1",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as { teamId?: string }).teamId).toBe("team-1");
    }
  });

  test("teamId does NOT leak into updateConfiguration / validateConfiguration inputs", () => {
    // updateConfiguration's body is UpdateHealthCheckConfigurationSchema; the
    // body schema must not strip-accept a teamId-as-update field. validate's
    // input is the create skeleton WITHOUT the contract-level teamId extend.
    const validateParsed = inputSchemaFor("validateConfiguration").safeParse({
      ...validCreate,
      teamId: "team-1",
    });
    // zod objects strip unknown keys by default, so parse succeeds but teamId
    // is dropped (not carried as an owning-team signal on validate).
    expect(validateParsed.success).toBe(true);
    if (validateParsed.success) {
      expect(
        (validateParsed.data as Record<string, unknown>).teamId,
      ).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Detailed run history is a MANAGER surface: global `configuration.manage`, a
// team manage grant on the CONFIGURATION, or manage access to the SYSTEM (a
// system's owning team sees all of its runs). That triple-OR is enforced in
// the HANDLER (healthcheck-backend/src/history-access.ts), so all three
// history procs deliberately carry an EMPTY declarative `access` and no
// instanceAccess - if a rule/mode is ever added back here without removing
// the handler logic, revisit both together. Also guards the three-way gate
// drift that previously existed (route allowed `read`, page required manage
// capability, procedures required the removed standalone `details` rule).
// ---------------------------------------------------------------------------
describe("detailed run history is handler-authorized (manage or system-owner)", () => {
  const historyProcs = [
    "getDetailedHistory",
    "getDetailedAggregatedHistory",
    "getRunById",
  ] as const;

  for (const procName of historyProcs) {
    test(`${procName} is authenticated-only with empty access and no instanceAccess`, () => {
      const meta = metaFor(procName);
      // Anonymous callers can never hold manage access, so the procs must not
      // be `public` (that would only produce guaranteed-403 attempts).
      expect(meta.userType).toBe("authenticated");
      expect(meta.access).toEqual([]);
      expect(meta.instanceAccess).toBeUndefined();
    });
  }

  test("getRunById takes only `runId` - the run's own fields are the authorization anchor", () => {
    expect(
      inputSchemaFor("getRunById").safeParse({ runId: "run-1" }).success,
    ).toBe(true);
  });

  test("the standalone details rule is gone from the access surface", () => {
    expect(
      (healthCheckAccess as Record<string, unknown>).details,
    ).toBeUndefined();
  });
});

describe("getBulkAssignedHealthCheckCounts gating (bulk badge, no N+1)", () => {
  test("read-authenticated, parentScope catalog.system / read / recordKey=counts", () => {
    // Mirrors the per-system getSystemAssociations authorization it replaces:
    // configuration.read + parentScope on catalog.system read, but as a bulk
    // record keyed by systemId so recordKey filters each entry by the caller's
    // read grant. Must NOT weaken to `public` or drop the parent scope.
    const meta = metaFor("getBulkAssignedHealthCheckCounts");
    expect(meta.userType).toBe("authenticated");
    const ia = meta.instanceAccess;
    expect(ia?.parentScope).toBeDefined();
    expect(ia?.parentScope?.resourceType).toBe("catalog.system");
    expect(ia?.parentScope?.action).toBe("read");
    expect(ia?.parentScope?.recordKey).toBe("counts");
    // No instance/list scoping fields - it is a record-keyed bulk read.
    expect(ia?.idParam).toBeUndefined();
    expect(ia?.listKey).toBeUndefined();
    expect(ia?.recordKey).toBeUndefined();
  });

  test("input is a systemIds array; output is a counts record", () => {
    expect(
      inputSchemaFor("getBulkAssignedHealthCheckCounts").safeParse({
        systemIds: ["sys-1", "sys-2"],
      }).success,
    ).toBe(true);
  });
});
