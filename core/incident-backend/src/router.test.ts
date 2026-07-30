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
  healthOverride: string | null;
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
    healthOverride: null,
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
  // Echoes the patch back onto the incident so an override-only edit still
  // resolves the affected systemIds for the lifecycle hook payload.
  const updateIncident = mock(async (input: { id: string }) =>
    PRESENT.has(input.id) ? makeIncident(input.id) : undefined,
  );

  // Existence only - the READ post-filter is the platform middleware's job,
  // which is exactly what the resolveIncidentRefs tests below prove.
  const findExistingIncidentIds = mock(async (ids: string[]) =>
    ids.filter((id) => PRESENT.has(id)),
  );

  const service = {
    getIncident,
    deleteIncident,
    resolveIncident,
    updateIncident,
    findExistingIncidentIds,
  } as unknown as Parameters<typeof createRouter>[0]["service"];

  const invalidateForMutation = mock(async () => {});
  const broadcast = mock(async () => {});
  const emit = mock(async () => {});
  const notifyForSubscription = mock(async () => {});
  const getSystem = mock(async () => undefined);
  const getUserById = mock(async () => undefined);

  // Cast test doubles: the router only touches these members on the bulk paths.
  const router = createRouter({
    service,
    signalService: { broadcast } as unknown as Parameters<
      typeof createRouter
    >[0]["signalService"],
    eventBus: { emit } as unknown as Parameters<
      typeof createRouter
    >[0]["eventBus"],
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

  return {
    router,
    deleteIncident,
    resolveIncident,
    updateIncident,
    findExistingIncidentIds,
    emit,
    invalidateForMutation,
    notifyForSubscription,
  };
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

describe("incident router resolveIncident notification", () => {
  it("carries the resolution note into the subscriber notification body", async () => {
    const { router, notifyForSubscription } = buildRouter();
    const ctx = teamScopedContext(["inc-ok"]);

    await call(
      router.resolveIncident,
      { id: "inc-ok", message: "Root cause fixed and services restored" },
      { context: ctx },
    );

    expect(notifyForSubscription).toHaveBeenCalledTimes(1);
    const payload = (
      notifyForSubscription.mock.calls[0] as unknown[] | undefined
    )?.[0] as { body?: string } | undefined;
    expect(payload?.body).toContain("has been resolved");
    // The operator's resolution note must reach subscribers, not be dropped.
    expect(payload?.body).toContain("Root cause fixed and services restored");
  });
});

describe("incident lifecycle hook", () => {
  it("fires incident.lifecycle.changed on an override-only update (with affected systemIds)", async () => {
    // The reactive `incident` entity state is {status, severity, systemIds}, so
    // clearing/adding a healthOverride with no other change emits no entity
    // change. This hook MUST still fire so SLO can open/close incident-forced
    // downtime — the whole reason it exists alongside INCIDENT_UPDATED.
    const { router, emit } = buildRouter();
    const ctx = teamScopedContext(["inc-ok"]);

    await call(
      router.updateIncident,
      { id: "inc-ok", healthOverride: null },
      { context: ctx },
    );

    expect(emit).toHaveBeenCalledTimes(1);
    const emitArgs = emit.mock.calls[0] as unknown[] | undefined;
    const hook = emitArgs?.[0] as { id?: string } | undefined;
    const payload = emitArgs?.[1] as
      | { systemIds?: string[]; action?: string }
      | undefined;
    expect(hook?.id).toBe("incident.lifecycle.changed");
    expect(payload?.action).toBe("updated");
    expect(payload?.systemIds).toEqual(["sys-1"]);
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

/**
 * `resolveIncidentRefs` backs viewability-aware mention rendering: a `#`
 * reference becomes a link only when the reader may actually open the target.
 *
 * These drive the REAL procedure through `call`, so the contract's
 * `listKey: "incidents"` post-filter runs. That matters more than the handler
 * body - the handler only establishes existence, and it is the middleware that
 * turns "exists" into "and you may read it". A regression that dropped the
 * `listKey` declaration would leave the handler passing and silently link every
 * incident in the estate to a team-scoped reader.
 */
describe("incident router resolveIncidentRefs", () => {
  it("returns only ids the team-scoped caller may READ", async () => {
    const { router } = buildRouter();
    const ctx = teamScopedContext(["inc-ok"]);

    const { incidents } = await call(
      router.resolveIncidentRefs,
      { ids: ["inc-ok", "inc-throw"] },
      { context: ctx },
    );

    // Both exist; only "inc-ok" is granted.
    expect(incidents).toEqual([{ id: "inc-ok" }]);
  });

  it("omits an id that does not exist, even when granted", async () => {
    // A reference to a DELETED incident must not become a link either.
    const { router } = buildRouter();
    const ctx = teamScopedContext(["inc-ok", "inc-missing"]);

    const { incidents } = await call(
      router.resolveIncidentRefs,
      { ids: ["inc-ok", "inc-missing"] },
      { context: ctx },
    );

    expect(incidents).toEqual([{ id: "inc-ok" }]);
  });

  it("makes an unreadable incident indistinguishable from a missing one", async () => {
    // Both come back as simple absence - no error, no title, nothing that
    // confirms the unreadable incident exists.
    const { router } = buildRouter();
    const ctx = teamScopedContext([]);

    const { incidents } = await call(
      router.resolveIncidentRefs,
      { ids: ["inc-ok", "inc-missing"] },
      { context: ctx },
    );

    expect(incidents).toEqual([]);
  });

  it("discloses nothing beyond the id", async () => {
    // The label already lives in the authored markdown, so the response has no
    // reason to carry titles - and must not, since it is reached by anyone who
    // can read ANY incident.
    const { router } = buildRouter();
    const ctx = teamScopedContext(["inc-ok"]);

    const { incidents } = await call(
      router.resolveIncidentRefs,
      { ids: ["inc-ok"] },
      { context: ctx },
    );

    expect(Object.keys(incidents[0] ?? {})).toEqual(["id"]);
  });

  it("accepts an empty id list without querying", async () => {
    const { router, findExistingIncidentIds } = buildRouter();
    const ctx = teamScopedContext(["inc-ok"]);

    const { incidents } = await call(
      router.resolveIncidentRefs,
      { ids: [] },
      { context: ctx },
    );

    expect(incidents).toEqual([]);
    expect(findExistingIncidentIds).toHaveBeenCalledWith([]);
  });

  it("rejects an id list beyond the contract's bound", async () => {
    // The input is reachable by any reader, so the batch size is capped rather
    // than letting one request probe the whole estate.
    const { router } = buildRouter();
    const ctx = teamScopedContext(["inc-ok"]);

    await expect(
      call(
        router.resolveIncidentRefs,
        { ids: Array.from({ length: 201 }, (_, i) => `inc-${i}`) },
        { context: ctx },
      ),
    ).rejects.toThrow();
  });
});
