import { describe, test, expect } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
  StatusWidgetTypeExtensionPoint,
} from "@checkstack/status-page-backend";
import { registerHealthcheckStatusWidgets } from "./widgets";

/**
 * Widget-level regression coverage for status-page environment filtering (the
 * gap that let the standalone uptime widget slip through). Exercises the four
 * health widgets directly against a mocked trusted rpcClient, asserting that a
 * published-environment set:
 *  - omits systems outside the selected environments from banner / systemHealth
 *    / groupStatus AND blanks the single-system uptime widget, and
 *  - folds the WHOLE-SYSTEM incident override into the env-scoped health rollup
 *    (a prod system whose prod checks are green but which is under an active
 *    incident-forced outage still reads as an outage on a prod-scoped page).
 */

/** Per-system per-environment CHECKS status, as getBulkSystemHealthMatrix returns. */
type MatrixEnvStatus = "healthy" | "degraded" | "unhealthy";

interface MockData {
  /** environmentId -> member system ids (catalog env->systems mapping). */
  envSystems: Record<string, string[]>;
  /** systemId -> display name. */
  systemNames: Record<string, string>;
  /** systemId -> per-environment CHECKS status. */
  matrix: Record<string, Record<string, MatrixEnvStatus>>;
  /** systemId -> whole-system incident override status (folded, worst-wins). */
  overrides?: Record<string, MatrixEnvStatus>;
  /** systemId -> total uptime percent (for the uptime widget). */
  uptimePct?: Record<string, number>;
  /** catalog groupId -> member system ids. */
  groups?: Record<string, string[]>;
}

function widgetsById(): Map<string, WidgetTypeDefinition> {
  const map = new Map<string, WidgetTypeDefinition>();
  const ext: StatusWidgetTypeExtensionPoint = {
    registerWidgetType: (def) => map.set(def.id, def),
  };
  registerHealthcheckStatusWidgets(ext);
  return map;
}

function makeCtx(args: {
  data: MockData;
  publishedEnvironmentIds?: string[];
}): WidgetResolveContext {
  const { data, publishedEnvironmentIds } = args;
  const memo = new Map<string, Promise<unknown>>();
  const api = {
    // catalog
    resolveEnvironments: async ({
      environmentIds,
    }: {
      environmentIds: string[];
    }) =>
      environmentIds.map((id) => ({
        id,
        name: id,
        description: null,
        systemIds: data.envSystems[id] ?? [],
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    getSystems: async () => ({
      systems: Object.entries(data.systemNames).map(([id, name]) => ({
        id,
        name,
      })),
    }),
    getGroups: async () =>
      Object.entries(data.groups ?? {}).map(([id, systemIds]) => ({
        id,
        name: id,
        systemIds,
      })),
    // maintenance
    getBulkMaintenancesForSystems: async () => ({ maintenances: {} }),
    // healthcheck
    getBulkSystemHealthMatrix: async ({ systemIds }: { systemIds: string[] }) => {
      const statuses: Record<
        string,
        {
          status: MatrixEnvStatus;
          checkStatuses: never[];
          environments: Record<
            string,
            { status: MatrixEnvStatus; checkStatuses: never[] }
          >;
        }
      > = {};
      for (const id of systemIds) {
        const envs = data.matrix[id];
        if (!envs) continue;
        statuses[id] = {
          status: "healthy",
          checkStatuses: [],
          environments: Object.fromEntries(
            Object.entries(envs).map(([env, status]) => [
              env,
              { status, checkStatuses: [] },
            ]),
          ),
        };
      }
      return { statuses };
    },
    getBulkSystemHealthStatus: async ({ systemIds }: { systemIds: string[] }) => {
      const statuses: Record<
        string,
        {
          status: MatrixEnvStatus;
          evaluatedAt: Date;
          checkStatuses: never[];
          override?: { status: MatrixEnvStatus; source: string; reason: string };
        }
      > = {};
      for (const id of systemIds) {
        const override = data.overrides?.[id];
        statuses[id] = {
          status: "healthy",
          evaluatedAt: new Date(),
          checkStatuses: [],
          ...(override
            ? { override: { status: override, source: "incident", reason: "x" } }
            : {}),
        };
      }
      return { statuses };
    },
    getRunStats: async ({ systemId }: { systemId: string }) => {
      const pct = data.uptimePct?.[systemId] ?? 100;
      return {
        window: { start: "2026-07-01T00:00:00Z", end: "2026-07-02T00:00:00Z" },
        bucketIntervalSeconds: 86_400,
        total: {
          runCount: 10,
          healthy: 10,
          degraded: 0,
          unhealthy: 0,
          uptimePct: pct,
        },
        buckets: [
          {
            start: "2026-07-01T00:00:00Z",
            end: "2026-07-02T00:00:00Z",
            runCount: 10,
            healthy: 10,
            degraded: 0,
            unhealthy: 0,
            uptimePct: pct,
          },
        ],
      };
    },
  };
  return {
    rpcClient: { forPlugin: () => api } as unknown as RpcClient,
    cache: <T,>(key: string, loader: () => Promise<T>): Promise<T> => {
      const existing = memo.get(key);
      if (existing) return existing as Promise<T>;
      const created = loader();
      memo.set(key, created);
      return created;
    },
    publishedEnvironmentIds,
  };
}

// prod-sys: prod only (checks healthy, but under an active incident override).
// stage-sys: staging only (checks unhealthy).
// both-sys: prod + staging (prod healthy, staging unhealthy).
const DATA: MockData = {
  envSystems: {
    prod: ["prod-sys", "both-sys"],
    stage: ["stage-sys", "both-sys"],
  },
  systemNames: {
    "prod-sys": "Prod System",
    "stage-sys": "Stage System",
    "both-sys": "Both System",
  },
  matrix: {
    "prod-sys": { prod: "healthy" },
    "stage-sys": { stage: "unhealthy" },
    "both-sys": { prod: "healthy", stage: "unhealthy" },
  },
  overrides: { "prod-sys": "unhealthy" }, // whole-system incident-forced outage
  uptimePct: { "prod-sys": 99, "stage-sys": 50, "both-sys": 88 },
  groups: { g1: ["prod-sys", "stage-sys"] },
};

describe("health widgets — environment filtering (E3 regression)", () => {
  const publishedEnvironmentIds = ["prod"];

  test("systemHealth omits staging-only systems and folds the whole-system override", async () => {
    const widget = widgetsById().get("systemHealth")!;
    const ctx = makeCtx({ data: DATA, publishedEnvironmentIds });
    const result = (await widget.resolvePublic({
      config: {
        items: [
          { systemId: "prod-sys" },
          { systemId: "stage-sys" },
          { systemId: "both-sys" },
        ],
      },
      ctx,
    })) as { systems: Array<{ label: string; status: string }> };
    // stage-sys is dropped; prod-sys shows the incident override (major_outage)
    // even though its prod checks are healthy; both-sys shows its prod checks.
    expect(result.systems).toEqual([
      { label: "Prod System", status: "major_outage" },
      { label: "Both System", status: "operational" },
    ]);
  });

  test("banner rolls up only env-visible systems, override included", async () => {
    const widget = widgetsById().get("banner")!;
    const ctx = makeCtx({ data: DATA, publishedEnvironmentIds });
    const result = (await widget.resolvePublic({
      config: { systemIds: ["prod-sys", "stage-sys", "both-sys"] },
      ctx,
    })) as { status: string };
    // Visible = {prod-sys (major via override), both-sys (operational)} ->
    // some-but-not-all down = partial_outage. stage-sys never counted.
    expect(result.status).toBe("partial_outage");
  });

  test("groupStatus drops group members outside the published environments", async () => {
    const widget = widgetsById().get("groupStatus")!;
    const ctx = makeCtx({ data: DATA, publishedEnvironmentIds });
    const result = (await widget.resolvePublic({
      config: { groupId: "g1" },
      ctx,
    })) as { systems: Array<{ label: string; status: string }>; status: string };
    // g1 = [prod-sys, stage-sys]; only prod-sys is in prod. Its override lifts
    // it to major_outage; stage-sys is omitted entirely.
    expect(result.systems).toEqual([
      { label: "Prod System", status: "major_outage" },
    ]);
    expect(result.status).toBe("major_outage");
  });

  test("uptime widget is blanked for a system outside the published environments", async () => {
    const widget = widgetsById().get("uptime")!;
    const ctx = makeCtx({ data: DATA, publishedEnvironmentIds });
    const result = (await widget.resolvePublic({
      config: { systemId: "stage-sys", days: 30 },
      ctx,
    })) as { label: string; uptimePct: number; bars: unknown[] };
    // Out of scope -> blank empty-state DTO (no bars, no misleading percent).
    expect(result.bars).toEqual([]);
    expect(result.uptimePct).toBe(0);
  });

  test("uptime widget renders normally for an in-scope system", async () => {
    const widget = widgetsById().get("uptime")!;
    const ctx = makeCtx({ data: DATA, publishedEnvironmentIds });
    const result = (await widget.resolvePublic({
      config: { systemId: "prod-sys", days: 30 },
      ctx,
    })) as { label: string; uptimePct: number; bars: unknown[] };
    expect(result.label).toBe("Prod System");
    expect(result.bars.length).toBe(1);
    expect(result.uptimePct).toBe(99);
  });
});

describe("health widgets — no environment filter (unchanged behavior)", () => {
  test("systemHealth keeps every system and uses the folded cross-env status", async () => {
    const widget = widgetsById().get("systemHealth")!;
    const ctx = makeCtx({ data: DATA }); // no publishedEnvironmentIds
    const result = (await widget.resolvePublic({
      config: {
        items: [{ systemId: "prod-sys" }, { systemId: "stage-sys" }],
      },
      ctx,
    })) as { systems: Array<{ label: string; status: string }> };
    // All-env path reads getBulkSystemHealthStatus.status (healthy in the mock)
    // for both systems; no system is dropped.
    expect(result.systems).toEqual([
      { label: "Prod System", status: "operational" },
      { label: "Stage System", status: "operational" },
    ]);
  });

  test("uptime widget is never blanked when no environment filter is set", async () => {
    const widget = widgetsById().get("uptime")!;
    const ctx = makeCtx({ data: DATA });
    const result = (await widget.resolvePublic({
      config: { systemId: "stage-sys", days: 30 },
      ctx,
    })) as { bars: unknown[]; uptimePct: number };
    expect(result.bars.length).toBe(1);
    expect(result.uptimePct).toBe(50);
  });
});
