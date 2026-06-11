import { CatalogApi, assertCatalogResourcesReadable } from "@checkstack/catalog-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import {
  pluginMetadata as statusPagePluginMetadata,
  MaintenanceConfigSchema,
  MaintenanceDtoSchema,
  toPublicUpdate,
  type InternalUpdate,
  type PublicUpdate,
} from "@checkstack/status-page-common";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
  StatusWidgetTypeExtensionPoint,
} from "@checkstack/status-page-backend";

const SYSTEM_TYPE = "catalog.system";

/** Newest `max` updates, most-recent first. */
function latestUpdates(updates: InternalUpdate[], max: number): PublicUpdate[] {
  return updates
    .toSorted(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, max)
    .map((u) => toPublicUpdate(u));
}

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
      includeCompleted: c.includePast,
    });
    const inScope = all.filter((m) => m.systemIds.some((s) => bound.has(s)));
    // Active (scheduled/in-progress) shown SOONEST-first (by start); recently
    // completed shown most-recent-first and age-filtered by window end. (Done
    // inline rather than via selectEvents because active and past sort on
    // different timestamps here.)
    const at = (v: string | Date) =>
      v instanceof Date ? v.getTime() : new Date(v).getTime();
    const active = inScope
      .filter((m) => m.status === "scheduled" || m.status === "in_progress")
      .toSorted((a, b) => at(a.startAt) - at(b.startAt))
      .slice(0, c.limit);
    const cutoff = Date.now() - c.pastMaxAgeDays * 86_400_000;
    const past = c.includePast
      ? inScope
          .filter((m) => m.status === "completed" && at(m.endAt) >= cutoff)
          .toSorted((a, b) => at(b.endAt) - at(a.endAt))
          .slice(0, c.limit)
      : [];
    const names = await labelsFor(ctx, [...bound]);
    const items = await Promise.allSettled(
      [...active, ...past].map(async (m) => {
        // showUpdates=false also skips the per-item detail fetch (perf).
        const detail = c.showUpdates ? await mc.getMaintenance({ id: m.id }) : null;
        return {
          id: m.id,
          title: m.title,
          status: m.status,
          startAt: iso(m.startAt),
          endAt: iso(m.endAt),
          systems: m.systemIds
            .map((id) => names.get(id))
            .filter((l): l is string => l !== undefined),
          updates: latestUpdates(
            (detail?.updates ?? []) as InternalUpdate[],
            c.maxUpdates,
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
