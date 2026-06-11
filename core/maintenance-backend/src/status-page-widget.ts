import { CatalogApi, assertCatalogResourcesReadable } from "@checkstack/catalog-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import {
  pluginMetadata as statusPagePluginMetadata,
  MaintenanceConfigSchema,
  MaintenanceDtoSchema,
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

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

const maintenance: WidgetTypeDefinition = {
  id: "maintenance",
  displayName: "Scheduled maintenance",
  description: "Upcoming and in-progress maintenance windows.",
  category: "Events",
  binding: "systems",
  configSchema: MaintenanceConfigSchema,
  dtoSchema: MaintenanceDtoSchema,
  boundResources: (config) =>
    MaintenanceConfigSchema.parse(config).systemIds.map((id) => ({
      resourceType: SYSTEM_TYPE,
      resourceId: id,
    })),
  assertBindingsReadable: async ({ userClient, config }) => {
    await assertCatalogResourcesReadable({
      client: userClient.forPlugin(CatalogApi),
      systemIds: MaintenanceConfigSchema.parse(config).systemIds,
    });
  },
  async resolvePublic({ config, ctx }) {
    const c = MaintenanceConfigSchema.parse(config);
    const bound = new Set(c.systemIds);
    // FAIL CLOSED: no systems bound -> expose nothing (never "all maintenances").
    if (bound.size === 0) return MaintenanceDtoSchema.parse({ maintenances: [] });
    const mc = ctx.rpcClient.forPlugin(MaintenanceApi);
    const { maintenances: all } = await mc.listMaintenances({
      includeCompleted: false,
    });
    const sorted = all
      .filter((m) => m.systemIds.some((s) => bound.has(s)))
      .toSorted(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      )
      .slice(0, c.limit);
    const names = await labelsFor(ctx, [...bound]);
    const items = await Promise.allSettled(
      sorted.map(async (m) => {
        const detail = await mc.getMaintenance({ id: m.id });
        return {
          id: m.id,
          title: m.title,
          status: m.status,
          startAt: iso(m.startAt),
          endAt: iso(m.endAt),
          systems: m.systemIds
            .map((id) => names.get(id))
            .filter((l): l is string => l !== undefined),
          updates: ((detail?.updates ?? []) as InternalUpdate[]).map((u) =>
            toPublicUpdate(u),
          ),
        };
      }),
    );
    return MaintenanceDtoSchema.parse({
      maintenances: items
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value),
    });
  },
};

/** Register the maintenance-owned status-page widget under `statuspage.*`. */
export function registerMaintenanceStatusWidgets(
  ext: StatusWidgetTypeExtensionPoint,
): void {
  ext.registerWidgetType(maintenance, statusPagePluginMetadata);
}
