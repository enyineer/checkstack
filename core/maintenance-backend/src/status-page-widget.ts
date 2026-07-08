import { CatalogApi, assertCatalogResourcesReadable } from "@checkstack/catalog-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import {
  pluginMetadata as statusPagePluginMetadata,
  MaintenanceConfigSchema,
  MaintenanceDtoSchema,
  toPublicUpdate,
  resolveEventFeedScope,
  type InternalUpdate,
  type PublicUpdate,
} from "@checkstack/status-page-common";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
  StatusWidgetTypeExtensionPoint,
} from "@checkstack/status-page-backend";

const SYSTEM_TYPE = "catalog.system";
const GROUP_TYPE = "catalog.group";

/** Current membership of every catalog group, fetched once per page resolve. */
async function groupMembers(
  ctx: WidgetResolveContext,
): Promise<Map<string, string[]>> {
  const groups = await ctx.cache("catalog.groups", async () => {
    const all = await ctx.rpcClient.forPlugin(CatalogApi).getGroups();
    return all.map((g) => ({ id: g.id, systemIds: g.systemIds }));
  });
  return new Map(groups.map((g) => [g.id, g.systemIds] as const));
}

/** Newest `max` updates, most-recent first. */
function latestUpdates(updates: InternalUpdate[], max: number): PublicUpdate[] {
  return updates
    // The public status page is anonymous: only `public`-visibility updates may
    // appear. `logged_in` / `internal` updates are filtered out here so they
    // never reach the unauthenticated projection (Item 3/5).
    .filter((u) => u.visibility === "public")
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

/**
 * The CURRENT effective set of catalog system ids this maintenance config
 * surfaces: `(systemIds ∪ members(groupIds)) − excludedSystemIds`, expanded from
 * the SAME live catalog source (`groupMembers` via `getGroups`) the DTO resolve
 * uses. Shared by `resolvePublic` (what the widget shows) and
 * `resolveScopedSystems` (what the subscriber fan-out is allowed to email about)
 * so the two can NEVER diverge. Empty when nothing is bound (fail closed).
 */
async function effectiveScope(
  config: unknown,
  ctx: WidgetResolveContext,
): Promise<Set<string>> {
  const c = MaintenanceConfigSchema.parse(config);
  if (c.systemIds.length === 0 && c.groupIds.length === 0) return new Set();
  return resolveEventFeedScope({
    systemIds: c.systemIds,
    groupIds: c.groupIds,
    excludedSystemIds: c.excludedSystemIds,
    groupMembers: c.groupIds.length > 0 ? await groupMembers(ctx) : new Map(),
  });
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
  boundResources: (config) => {
    const c = MaintenanceConfigSchema.parse(config);
    return [
      ...c.systemIds.map((id) => ({ resourceType: SYSTEM_TYPE, resourceId: id })),
      ...c.groupIds.map((id) => ({ resourceType: GROUP_TYPE, resourceId: id })),
    ];
  },
  assertBindingsReadable: async ({ userClient, config }) => {
    const c = MaintenanceConfigSchema.parse(config);
    await assertCatalogResourcesReadable({
      client: userClient.forPlugin(CatalogApi),
      systemIds: c.systemIds,
      groupIds: c.groupIds,
    });
  },
  // Send-time scoping for the subscriber fan-out uses the SAME expansion as the
  // DTO resolve, so a page never emails about a system its widget does not show.
  resolveScopedSystems: ({ config, ctx }) => effectiveScope(config, ctx),
  async resolvePublic({ config, ctx }) {
    const c = MaintenanceConfigSchema.parse(config);
    // FAIL CLOSED with NO read when nothing is bound (never "all maintenances").
    // The effective scope is resolved at read time (shared with
    // resolveScopedSystems) so group members added later are included.
    const bound = await effectiveScope(c, ctx);
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
    // Bound-only labels; a per-system PUBLIC label override wins over the raw
    // catalog name (same override path as the system-health widget) so the public
    // detail page never leaks an internal name inconsistently with the page.
    const names = await labelsFor(ctx, [...bound]);
    const labelOf = (id: string): string | undefined =>
      bound.has(id) ? (c.systemLabels[id] ?? names.get(id) ?? id) : undefined;
    const selected = [...active, ...past];
    // ONE bulk fetch of every selected maintenance's update timeline, instead
    // of an N+1 fan-out of `getMaintenance` per row. showUpdates=false still
    // skips the fetch entirely (perf). Updates are keyed by maintenance id.
    const bulkUpdates = c.showUpdates
      ? await mc.getBulkMaintenanceUpdates({
          maintenanceIds: selected.map((m) => m.id),
        })
      : undefined;
    const updatesByMaintenance: Record<string, InternalUpdate[]> =
      bulkUpdates?.updates ?? {};
    const items = selected.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      startAt: iso(m.startAt),
      endAt: iso(m.endAt),
      systems: m.systemIds
        .map((id) => labelOf(id))
        .filter((l): l is string => l !== undefined),
      updates: latestUpdates(updatesByMaintenance[m.id] ?? [], c.maxUpdates),
    }));
    return MaintenanceDtoSchema.parse({ maintenances: items });
  },
};

/** Register the maintenance-owned status-page widget under `statuspage.*`. */
export function registerMaintenanceStatusWidgets(
  ext: StatusWidgetTypeExtensionPoint,
): void {
  ext.registerWidgetType(maintenance, statusPagePluginMetadata);
}
