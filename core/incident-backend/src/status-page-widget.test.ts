import { describe, test, expect } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
} from "@checkstack/status-page-backend";
import { registerIncidentStatusWidgets } from "./status-page-widget";

/** Capture the single widget the plugin registers, to exercise it directly. */
function capture(): WidgetTypeDefinition {
  let captured: WidgetTypeDefinition | undefined;
  registerIncidentStatusWidgets({
    registerWidgetType: (def) => {
      captured = def;
    },
  });
  if (!captured) throw new Error("no widget registered");
  return captured;
}

/** A context that throws on ANY read — proves the resolver touched no data. */
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

describe("incidents widget — fail closed (S1)", () => {
  test("no bound systems resolves to empty without reading anything", async () => {
    const widget = capture();
    expect(
      await widget.resolvePublic({ config: {}, ctx: noReadCtx }),
    ).toEqual({ incidents: [] });
  });

  test("binds exactly the configured systems (publish-gate input)", () => {
    expect(
      capture().boundResources({ systemIds: ["s1", "s2"], limit: 5 }),
    ).toEqual([
      { resourceType: "catalog.system", resourceId: "s1" },
      { resourceType: "catalog.system", resourceId: "s2" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Environment filtering: when a page publishes a specific environment set, the
// widget omits systems (and thus incidents whose only affected system is)
// outside those environments - across resolvePublic AND resolveScopedSystems.
// ---------------------------------------------------------------------------

interface IncidentFixture {
  id: string;
  title: string;
  status: string;
  severity: string;
  systemIds: string[];
  createdAt: string;
  updatedAt: string;
}

function makeCtx(args: {
  publishedEnvironmentIds?: string[];
  incidents?: IncidentFixture[];
  /** environmentId -> member system ids (the catalog env->systems mapping). */
  envSystems?: Record<string, string[]>;
  systems?: Array<{ id: string; name: string }>;
}): WidgetResolveContext {
  const { publishedEnvironmentIds, incidents = [], envSystems = {}, systems = [] } =
    args;
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
    listIncidents: async () => ({ incidents }),
    getBulkIncidentUpdates: async () => ({ updates: {} }),
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

describe("incidents widget — environment filtering", () => {
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

  test("no env filter keeps every bound system", async () => {
    const widget = capture();
    const scope = await widget.resolveScopedSystems!({
      config: { systemIds: ["prod-sys", "stage-sys"] },
      ctx: makeCtx({ envSystems, systems }),
    });
    expect([...scope].toSorted()).toEqual(["prod-sys", "stage-sys"]);
  });

  test("resolvePublic drops a staging-only incident when publishing prod", async () => {
    const incidents: IncidentFixture[] = [
      {
        id: "stage-only",
        title: "Stage outage",
        status: "investigating",
        severity: "minor",
        systemIds: ["stage-sys"],
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
      {
        id: "prod-inc",
        title: "Prod outage",
        status: "investigating",
        severity: "major",
        systemIds: ["prod-sys"],
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ];
    const widget = capture();
    const result = (await widget.resolvePublic({
      config: { systemIds: ["prod-sys", "stage-sys"], showUpdates: false },
      ctx: makeCtx({
        publishedEnvironmentIds: ["prod"],
        incidents,
        envSystems,
        systems,
      }),
    })) as { incidents: Array<{ id: string; systems: string[] }> };
    expect(result.incidents.map((i) => i.id)).toEqual(["prod-inc"]);
  });

  test("multi-env incident is kept but labels only its published-env systems", async () => {
    const incidents: IncidentFixture[] = [
      {
        id: "both",
        title: "Cross-env outage",
        status: "investigating",
        severity: "major",
        systemIds: ["prod-sys", "stage-sys"],
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ];
    const widget = capture();
    const result = (await widget.resolvePublic({
      config: { systemIds: ["prod-sys", "stage-sys"], showUpdates: false },
      ctx: makeCtx({
        publishedEnvironmentIds: ["prod"],
        incidents,
        envSystems,
        systems,
      }),
    })) as { incidents: Array<{ id: string; systems: string[] }> };
    expect(result.incidents).toHaveLength(1);
    // Only the published-env (prod) system is labelled; the staging system is
    // not leaked even though the incident also affects it (multi-env caveat).
    expect(result.incidents[0]?.systems).toEqual(["Prod System"]);
  });
});
