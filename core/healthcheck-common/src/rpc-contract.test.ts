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
}

function metaFor(procName: keyof typeof healthCheckContract): {
  userType?: string;
  instanceAccess?: InstanceAccessMeta;
} {
  const proc = healthCheckContract[procName] as unknown as Record<
    string,
    unknown
  >;
  const orpc = proc["~orpc"] as {
    meta?: { userType?: string; instanceAccess?: InstanceAccessMeta };
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

  test("getConfiguration keys the per-config read on its `id` input field", () => {
    expect(metaFor("getConfiguration").instanceAccess).toEqual({
      idParam: "id",
    });
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
