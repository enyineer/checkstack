import { describe, test, expect } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
} from "@checkstack/status-page-backend";
import { registerMaintenanceStatusWidgets } from "./status-page-widget";

function capture(): WidgetTypeDefinition {
  let captured: WidgetTypeDefinition | undefined;
  registerMaintenanceStatusWidgets({
    registerWidgetType: (def) => {
      captured = def;
    },
  });
  if (!captured) throw new Error("no widget registered");
  return captured;
}

const noReadCtx: WidgetResolveContext = {
  rpcClient: {
    forPlugin: () => {
      throw new Error("must not read");
    },
  } as unknown as RpcClient,
  cache: () => {
    throw new Error("must not read");
  },
};

describe("maintenance widget — fail closed (S1)", () => {
  test("no bound systems resolves to empty without reading anything", async () => {
    const widget = capture();
    expect(
      await widget.resolvePublic({ config: {}, ctx: noReadCtx }),
    ).toEqual({ maintenances: [] });
  });
});

// ---------------------------------------------------------------------------
// Environment filtering: a page publishing a specific environment set omits
// systems (and maintenance windows whose only system is) outside those envs.
// ---------------------------------------------------------------------------

interface MaintenanceFixture {
  id: string;
  title: string;
  status: string;
  systemIds: string[];
  startAt: string;
  endAt: string;
}

function makeCtx(args: {
  publishedEnvironmentIds?: string[];
  maintenances?: MaintenanceFixture[];
  envSystems?: Record<string, string[]>;
  systems?: Array<{ id: string; name: string }>;
}): WidgetResolveContext {
  const {
    publishedEnvironmentIds,
    maintenances = [],
    envSystems = {},
    systems = [],
  } = args;
  const memo = new Map<string, Promise<unknown>>();
  const api = {
    resolveEnvironments: async ({
      environmentIds,
    }: {
      environmentIds: string[];
    }) =>
      environmentIds.map((id) => ({
        id,
        name: id,
        description: null,
        systemIds: envSystems[id] ?? [],
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    getGroups: async () => [],
    getSystems: async () => ({ systems }),
    listMaintenances: async () => ({ maintenances }),
    getBulkMaintenanceUpdates: async () => ({ updates: {} }),
  };
  return {
    rpcClient: {
      forPlugin: () => api,
    } as unknown as RpcClient,
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

describe("maintenance widget — environment filtering", () => {
  const envSystems = { prod: ["prod-sys"], stage: ["stage-sys"] };
  const systems = [
    { id: "prod-sys", name: "Prod System" },
    { id: "stage-sys", name: "Stage System" },
  ];

  test("resolveScopedSystems keeps only systems in the published env", async () => {
    const widget = capture();
    const scope = await widget.resolveScopedSystems!({
      config: { systemIds: ["prod-sys", "stage-sys"] },
      ctx: makeCtx({ publishedEnvironmentIds: ["prod"], envSystems, systems }),
    });
    expect([...scope].toSorted()).toEqual(["prod-sys"]);
  });

  test("resolvePublic drops a staging-only window when publishing prod", async () => {
    const maintenances: MaintenanceFixture[] = [
      {
        id: "stage-only",
        title: "Stage maintenance",
        status: "scheduled",
        systemIds: ["stage-sys"],
        startAt: "2026-07-10T00:00:00Z",
        endAt: "2026-07-10T01:00:00Z",
      },
      {
        id: "prod-window",
        title: "Prod maintenance",
        status: "scheduled",
        systemIds: ["prod-sys"],
        startAt: "2026-07-10T00:00:00Z",
        endAt: "2026-07-10T01:00:00Z",
      },
    ];
    const widget = capture();
    const result = (await widget.resolvePublic({
      config: { systemIds: ["prod-sys", "stage-sys"], showUpdates: false },
      ctx: makeCtx({
        publishedEnvironmentIds: ["prod"],
        maintenances,
        envSystems,
        systems,
      }),
    })) as { maintenances: Array<{ id: string; systems: string[] }> };
    expect(result.maintenances.map((m) => m.id)).toEqual(["prod-window"]);
  });
});
