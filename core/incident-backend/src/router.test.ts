import { describe, it, expect, mock } from "bun:test";
import { call } from "@orpc/server";
import { createMockRpcContext, type RpcContext } from "@checkstack/backend-api";
import { createRouter } from "./router";

/**
 * Bulk-action authorization + per-id partial-success tests for the incident
 * router. These drive the REAL `bulkDeleteIncidents` / `bulkResolveIncidents`
 * procedures through `call`, so the platform `bulkManage` middleware runs and
 * pre-partitions `input.ids` into the caller's authorized subset BEFORE the
 * handler. We assert:
 *   - only authorized ids are ever passed to the service (denied ids are never
 *     acted on — RLAC never-fail-open),
 *   - denied ids are reported `forbidden`, missing ids `notFound`, and a per-id
 *     service throw is isolated as `error` without aborting the batch.
 *
 * The caller is TEAM-SCOPED (no global rule); `listAccessibleObjectIds` returns
 * the granted subset, exactly as the auth backend would.
 */

interface FakeIncident {
  id: string;
  title: string;
  description?: string;
  status: string;
  severity: string;
  suppressNotifications: boolean;
  systemIds: string[];
  createdAt: Date;
  updatedAt: Date;
  updates: unknown[];
  links: unknown[];
}

function makeIncident(id: string, status = "investigating"): FakeIncident {
  return {
    id,
    title: `Incident ${id}`,
    status,
    severity: "major",
    suppressNotifications: false,
    systemIds: ["sys-1"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    updates: [],
    links: [],
  };
}

// Ids that resolve to a real incident. "inc-missing" is absent; "inc-throw"
// exists but its mutate throws.
const PRESENT = new Set(["inc-ok", "inc-throw"]);

function buildRouter() {
  const deleteIncident = mock(async (id: string) => {
    if (id === "inc-throw") throw new Error("db exploded");
    return PRESENT.has(id);
  });
  const resolveIncident = mock(async (id: string) => {
    if (id === "inc-throw") throw new Error("db exploded");
    return PRESENT.has(id) ? makeIncident(id, "resolved") : undefined;
  });
  const getIncident = mock(async (id: string) =>
    PRESENT.has(id) ? makeIncident(id) : undefined,
  );

  const service = {
    getIncident,
    deleteIncident,
    resolveIncident,
  } as unknown as Parameters<typeof createRouter>[0]["service"];

  const invalidateForMutation = mock(async () => {});
  const broadcast = mock(async () => {});
  const notifyForSubscription = mock(async () => {});
  const getSystem = mock(async () => undefined);
  const getUserById = mock(async () => undefined);

  // Cast test doubles: the router only touches these members on the bulk paths.
  const router = createRouter({
    service,
    signalService: { broadcast } as unknown as Parameters<
      typeof createRouter
    >[0]["signalService"],
    catalogClient: { getSystem } as unknown as Parameters<
      typeof createRouter
    >[0]["catalogClient"],
    notificationClient: { notifyForSubscription } as unknown as Parameters<
      typeof createRouter
    >[0]["notificationClient"],
    authClient: { getUserById } as unknown as Parameters<
      typeof createRouter
    >[0]["authClient"],
    logger: createMockRpcContext().logger,
    cache: { invalidateForMutation } as unknown as Parameters<
      typeof createRouter
    >[0]["cache"],
  });

  return { router, deleteIncident, resolveIncident, invalidateForMutation };
}

/** Team-scoped context: no global rule; only `granted` ids are grant-covered. */
function teamScopedContext(granted: string[]): RpcContext {
  const base = createMockRpcContext({
    pluginMetadata: { pluginId: "incident" },
    user: { type: "user", id: "u1", accessRules: [] },
  });
  return {
    ...base,
    auth: {
      ...base.auth,
      listAccessibleObjectIds: (p: { objectIds: string[] }) =>
        Promise.resolve(p.objectIds.filter((id) => granted.includes(id))),
    },
  };
}

describe("incident router bulkDeleteIncidents", () => {
  it("deletes only authorized ids and reports forbidden/notFound/error per id", async () => {
    const { router, deleteIncident } = buildRouter();
    const ctx = teamScopedContext(["inc-ok", "inc-missing", "inc-throw"]);

    const { results } = await call(
      router.bulkDeleteIncidents,
      { ids: ["inc-ok", "inc-missing", "inc-throw", "inc-forbidden"] },
      { context: ctx },
    );

    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]));
    expect(byId["inc-ok"]).toBe("deleted");
    expect(byId["inc-missing"]).toBe("notFound");
    expect(byId["inc-throw"]).toBe("error");
    expect(byId["inc-forbidden"]).toBe("forbidden");

    // The unauthorized id was NEVER passed to the service (never-fail-open).
    const deletedIds = deleteIncident.mock.calls.map((c) => c[0]);
    expect(deletedIds).not.toContain("inc-forbidden");
    expect(deletedIds).toContain("inc-ok");
  });

  it("reports every id forbidden when the caller has no grants at all", async () => {
    const { router, deleteIncident } = buildRouter();
    const ctx = teamScopedContext([]); // no grants

    const { results } = await call(
      router.bulkDeleteIncidents,
      { ids: ["inc-ok", "inc-throw"] },
      { context: ctx },
    );

    expect(results.every((r) => r.status === "forbidden")).toBe(true);
    expect(deleteIncident).not.toHaveBeenCalled();
  });
});

describe("incident router bulkResolveIncidents", () => {
  it("resolves only authorized ids and reports forbidden/notFound/error per id", async () => {
    const { router, resolveIncident } = buildRouter();
    const ctx = teamScopedContext(["inc-ok", "inc-missing", "inc-throw"]);

    const { results } = await call(
      router.bulkResolveIncidents,
      {
        ids: ["inc-ok", "inc-missing", "inc-throw", "inc-forbidden"],
        message: "batch resolve",
      },
      { context: ctx },
    );

    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]));
    expect(byId["inc-ok"]).toBe("resolved");
    expect(byId["inc-missing"]).toBe("notFound");
    expect(byId["inc-throw"]).toBe("error");
    expect(byId["inc-forbidden"]).toBe("forbidden");

    const resolvedIds = resolveIncident.mock.calls.map((c) => c[0]);
    expect(resolvedIds).not.toContain("inc-forbidden");
    expect(resolvedIds).toContain("inc-ok");
  });
});
