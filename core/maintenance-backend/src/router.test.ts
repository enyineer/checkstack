import { describe, it, expect, mock } from "bun:test";
import { call } from "@orpc/server";
import { createMockRpcContext, type RpcContext } from "@checkstack/backend-api";
import { createRouter } from "./router";

/**
 * Bulk-action authorization + per-id partial-success tests for the maintenance
 * router. These drive the REAL `bulkDeleteMaintenances` / `bulkCloseMaintenances`
 * procedures through `call`, so the platform `bulkManage` middleware runs and
 * pre-partitions `input.ids` before the handler. The "resolve"-equivalent for a
 * maintenance is CLOSE (status -> completed), so mass-resolve == bulk close.
 *
 * We assert only authorized ids are ever passed to the service (RLAC
 * never-fail-open), denied ids are reported `forbidden`, missing ids
 * `notFound`, and a per-id service throw is isolated as `error`.
 */

interface FakeMaintenance {
  id: string;
  title: string;
  description?: string;
  status: string;
  suppressNotifications: boolean;
  startAt: Date;
  endAt: Date;
  systemIds: string[];
  createdAt: Date;
  updatedAt: Date;
  updates: unknown[];
  links: unknown[];
}

function makeMaintenance(id: string, status = "scheduled"): FakeMaintenance {
  return {
    id,
    title: `Maintenance ${id}`,
    status,
    suppressNotifications: false,
    startAt: new Date("2026-01-01T00:00:00Z"),
    endAt: new Date("2026-01-01T01:00:00Z"),
    systemIds: ["sys-1"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    updates: [],
    links: [],
  };
}

const PRESENT = new Set(["m-ok", "m-throw"]);

function buildRouter() {
  const deleteMaintenance = mock(async (id: string) => {
    if (id === "m-throw") throw new Error("db exploded");
    return PRESENT.has(id);
  });
  const closeMaintenance = mock(async (id: string) => {
    if (id === "m-throw") throw new Error("db exploded");
    return PRESENT.has(id) ? makeMaintenance(id, "completed") : undefined;
  });
  const getMaintenance = mock(async (id: string) =>
    PRESENT.has(id) ? makeMaintenance(id) : undefined,
  );

  const service = {
    getMaintenance,
    deleteMaintenance,
    closeMaintenance,
  } as unknown as Parameters<typeof createRouter>[0]["service"];

  // Fake entity handle: run apply directly (mirrors withEntityWrite's no-handle
  // fallback) so the plugin write still executes without the real framework.
  const entityHandle = {
    mutate: async ({ apply }: { apply: () => Promise<unknown> }) => {
      await apply();
    },
    remove: async ({ apply }: { apply: () => Promise<unknown> }) => {
      await apply();
    },
  } as unknown as Parameters<typeof createRouter>[0]["entityHandle"];

  const broadcast = mock(async () => {});
  const invalidateForMutation = mock(async () => {});

  const router = createRouter({
    service,
    signalService: { broadcast } as unknown as Parameters<
      typeof createRouter
    >[0]["signalService"],
    catalogClient: {
      getSystem: mock(async () => undefined),
    } as unknown as Parameters<typeof createRouter>[0]["catalogClient"],
    notificationClient: {
      notifyForSubscription: mock(async () => {}),
    } as unknown as Parameters<typeof createRouter>[0]["notificationClient"],
    authClient: {
      getUserById: mock(async () => undefined),
    } as unknown as Parameters<typeof createRouter>[0]["authClient"],
    logger: createMockRpcContext().logger,
    cache: { invalidateForMutation } as unknown as Parameters<
      typeof createRouter
    >[0]["cache"],
    entityHandle,
  });

  return { router, deleteMaintenance, closeMaintenance };
}

function teamScopedContext(granted: string[]): RpcContext {
  const base = createMockRpcContext({
    pluginMetadata: { pluginId: "maintenance" },
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

describe("maintenance router bulkDeleteMaintenances", () => {
  it("deletes only authorized ids and reports forbidden/notFound/error per id", async () => {
    const { router, deleteMaintenance } = buildRouter();
    const ctx = teamScopedContext(["m-ok", "m-missing", "m-throw"]);

    const { results } = await call(
      router.bulkDeleteMaintenances,
      { ids: ["m-ok", "m-missing", "m-throw", "m-forbidden"] },
      { context: ctx },
    );

    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]));
    expect(byId["m-ok"]).toBe("deleted");
    expect(byId["m-missing"]).toBe("notFound");
    expect(byId["m-throw"]).toBe("error");
    expect(byId["m-forbidden"]).toBe("forbidden");

    const deletedIds = deleteMaintenance.mock.calls.map((c) => c[0]);
    expect(deletedIds).not.toContain("m-forbidden");
    expect(deletedIds).toContain("m-ok");
  });
});

describe("maintenance router bulkCloseMaintenances (mass resolve == complete)", () => {
  it("closes only authorized ids and reports forbidden/notFound/error per id", async () => {
    const { router, closeMaintenance } = buildRouter();
    const ctx = teamScopedContext(["m-ok", "m-missing", "m-throw"]);

    const { results } = await call(
      router.bulkCloseMaintenances,
      {
        ids: ["m-ok", "m-missing", "m-throw", "m-forbidden"],
        message: "batch complete",
      },
      { context: ctx },
    );

    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]));
    expect(byId["m-ok"]).toBe("completed");
    expect(byId["m-missing"]).toBe("notFound");
    expect(byId["m-throw"]).toBe("error");
    expect(byId["m-forbidden"]).toBe("forbidden");

    const closedIds = closeMaintenance.mock.calls.map((c) => c[0]);
    expect(closedIds).not.toContain("m-forbidden");
    expect(closedIds).toContain("m-ok");
  });
});
