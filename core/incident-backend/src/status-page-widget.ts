import { CatalogApi, assertCatalogResourcesReadable } from "@checkstack/catalog-common";
import { IncidentApi } from "@checkstack/incident-common";
import {
  pluginMetadata as statusPagePluginMetadata,
  IncidentsConfigSchema,
  IncidentsDtoSchema,
  toPublicUpdate,
  type InternalUpdate,
} from "@checkstack/status-page-common";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
  StatusWidgetTypeExtensionPoint,
} from "@checkstack/status-page-backend";

const SYSTEM_TYPE = "catalog.system";

async function labelsFor(
  ctx: WidgetResolveContext,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const all = await ctx.cache("catalog.systemNames", async () => {
    const { systems } = await ctx.rpcClient.forPlugin(CatalogApi).getSystems();
    return new Map(systems.map((s) => [s.id, s.name] as const));
  });
  const out = new Map<string, string>();
  for (const id of ids) {
    const name = all.get(id);
    if (name !== undefined) out.set(id, name);
  }
  return out;
}

const incidents: WidgetTypeDefinition = {
  id: "incidents",
  displayName: "Incidents",
  description: "Recent unresolved incidents with their update timeline.",
  category: "Events",
  binding: "systems",
  configSchema: IncidentsConfigSchema,
  dtoSchema: IncidentsDtoSchema,
  boundResources: (config) =>
    IncidentsConfigSchema.parse(config).systemIds.map((id) => ({
      resourceType: SYSTEM_TYPE,
      resourceId: id,
    })),
  assertBindingsReadable: async ({ userClient, config }) => {
    await assertCatalogResourcesReadable({
      client: userClient.forPlugin(CatalogApi),
      systemIds: IncidentsConfigSchema.parse(config).systemIds,
    });
  },
  async resolvePublic({ config, ctx }) {
    const c = IncidentsConfigSchema.parse(config);
    const bound = new Set(c.systemIds);
    // FAIL CLOSED: no systems bound -> nothing the operator chose to expose.
    // Never fall back to "all incidents" (that would be a trusted-service read
    // of every incident on the platform).
    if (bound.size === 0) return IncidentsDtoSchema.parse({ incidents: [] });
    const inc = ctx.rpcClient.forPlugin(IncidentApi);
    const { incidents: all } = await inc.listIncidents({ includeResolved: false });
    const sorted = all
      .filter((i) => i.systemIds.some((s) => bound.has(s)))
      .toSorted(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, c.limit);
    // Only label BOUND systems; an unbound co-affected system must not leak.
    const names = await labelsFor(ctx, [...bound]);
    const items = await Promise.allSettled(
      sorted.map(async (i) => {
        const detail = await inc.getIncident({ id: i.id });
        return {
          id: i.id,
          title: i.title,
          status: i.status,
          severity: i.severity,
          systems: i.systemIds
            .map((id) => names.get(id))
            .filter((l): l is string => l !== undefined),
          startedAt:
            i.createdAt instanceof Date
              ? i.createdAt.toISOString()
              : String(i.createdAt),
          updates: ((detail?.updates ?? []) as InternalUpdate[]).map((u) =>
            toPublicUpdate(u),
          ),
        };
      }),
    );
    return IncidentsDtoSchema.parse({
      incidents: items
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value),
    });
  },
};

/** Register the incident-owned status-page widget under the `statuspage.*` namespace. */
export function registerIncidentStatusWidgets(
  ext: StatusWidgetTypeExtensionPoint,
): void {
  ext.registerWidgetType(incidents, statusPagePluginMetadata);
}
