import { CatalogApi, assertCatalogResourcesReadable } from "@checkstack/catalog-common";
import { IncidentApi } from "@checkstack/incident-common";
import {
  pluginMetadata as statusPagePluginMetadata,
  IncidentsConfigSchema,
  IncidentsDtoSchema,
  IncidentDtoItemSchema,
  toPublicUpdate,
  selectEvents,
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

/**
 * The catalog system ids visible under the page's published-environment scope,
 * or null when the page publishes all environments (no filter). Resolved once
 * per page resolve (cache-keyed by the env set) from the catalog's own
 * env->systems mapping, so a system in NONE of the selected environments is
 * omitted from what the widget shows, offers for subscription, and emails about.
 */
async function envVisibleSystems(
  ctx: WidgetResolveContext,
): Promise<Set<string> | null> {
  const envIds = ctx.publishedEnvironmentIds;
  if (!envIds || envIds.length === 0) return null;
  const key = `catalog.systemsInEnv:${[...envIds].toSorted().join(",")}`;
  const ids = await ctx.cache(key, async () => {
    const envs = await ctx.rpcClient
      .forPlugin(CatalogApi)
      .resolveEnvironments({ environmentIds: envIds });
    const set = new Set<string>();
    for (const env of envs) for (const s of env.systemIds) set.add(s);
    return [...set];
  });
  return new Set(ids);
}

/**
 * The CURRENT effective set of catalog system ids this incidents config
 * surfaces: `(systemIds ∪ members(groupIds)) − excludedSystemIds`, expanded from
 * the SAME live catalog source (`groupMembers` via `getGroups`) the DTO resolve
 * uses, then INTERSECTED with the page's published-environment scope. Shared by
 * `resolvePublic` (what the widget shows) and `resolveScopedSystems` (what the
 * subscriber fan-out is allowed to email about) so the two can NEVER diverge.
 * Empty when nothing is bound (fail closed).
 */
async function effectiveScope(
  config: unknown,
  ctx: WidgetResolveContext,
): Promise<Set<string>> {
  const c = IncidentsConfigSchema.parse(config);
  if (c.systemIds.length === 0 && c.groupIds.length === 0) return new Set();
  const scope = resolveEventFeedScope({
    systemIds: c.systemIds,
    groupIds: c.groupIds,
    excludedSystemIds: c.excludedSystemIds,
    groupMembers: c.groupIds.length > 0 ? await groupMembers(ctx) : new Map(),
  });
  const visible = await envVisibleSystems(ctx);
  if (!visible) return scope;
  return new Set([...scope].filter((id) => visible.has(id)));
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Public updates, most-recent first (the current progress at the top). `max`
 * caps the list for the summary BLOCK; omit it (the detail page) to return ALL
 * updates.
 */
function latestUpdates(
  updates: InternalUpdate[],
  max?: number,
): PublicUpdate[] {
  const sorted = updates
    // The public status page is anonymous: only `public`-visibility updates may
    // appear. `logged_in` / `internal` updates are filtered out here so they
    // never reach the unauthenticated projection (Item 3/5).
    .filter((u) => u.visibility === "public")
    .toSorted(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  return (max === undefined ? sorted : sorted.slice(0, max)).map((u) =>
    toPublicUpdate(u),
  );
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

const incidents: WidgetTypeDefinition = {
  id: "incidents",
  displayName: "Incidents",
  description: "Recent unresolved incidents with their update timeline.",
  category: "Events",
  binding: "systems",
  configSchema: IncidentsConfigSchema,
  dtoSchema: IncidentsDtoSchema,
  boundResources: (config) => {
    const c = IncidentsConfigSchema.parse(config);
    return [
      ...c.systemIds.map((id) => ({ resourceType: SYSTEM_TYPE, resourceId: id })),
      ...c.groupIds.map((id) => ({ resourceType: GROUP_TYPE, resourceId: id })),
    ];
  },
  assertBindingsReadable: async ({ userClient, config }) => {
    const c = IncidentsConfigSchema.parse(config);
    await assertCatalogResourcesReadable({
      client: userClient.forPlugin(CatalogApi),
      systemIds: c.systemIds,
      groupIds: c.groupIds,
    });
  },
  // This widget surfaces the INCIDENT category: a page emails incident
  // subscribers about a system only when this widget shows it.
  subscriptionCategory: "incident",
  // Send-time scoping for the subscriber fan-out uses the SAME expansion as the
  // DTO resolve, so a page never emails about a system its widget does not show.
  resolveScopedSystems: ({ config, ctx }) => effectiveScope(config, ctx),
  // Same effective scope WITH public display names, so the subscribe form can
  // offer a per-system scope. Applies the same public label override the widget
  // renders with, so a name here never differs from what the page shows.
  async resolveScopedSystemsDetailed({ config, ctx }) {
    const c = IncidentsConfigSchema.parse(config);
    const bound = await effectiveScope(c, ctx);
    if (bound.size === 0) return [];
    const names = await labelsFor(ctx, [...bound]);
    return [...bound].map((id) => ({
      id,
      name: c.systemLabels[id] ?? names.get(id) ?? id,
    }));
  },
  async resolvePublic({ config, ctx }) {
    const c = IncidentsConfigSchema.parse(config);
    // FAIL CLOSED with NO read when nothing is bound: never fall back to "all
    // incidents" (that would be a trusted-service read of every incident). The
    // effective scope is resolved at read time (shared with resolveScopedSystems)
    // so group members added later are included.
    const bound = await effectiveScope(c, ctx);
    if (bound.size === 0) return IncidentsDtoSchema.parse({ incidents: [] });
    const inc = ctx.rpcClient.forPlugin(IncidentApi);
    const { incidents: all } = await inc.listIncidents({
      includeResolved: c.includePast,
    });
    const inScope = all.filter((i) => i.systemIds.some((s) => bound.has(s)));
    // Active first, then recently-resolved within the configured max age.
    const { active, past } = selectEvents({
      items: inScope,
      isPast: (i) => i.status === "resolved",
      timestampOf: (i) => i.updatedAt,
      includePast: c.includePast,
      pastMaxAgeDays: c.pastMaxAgeDays,
      limit: c.limit,
      now: Date.now(),
    });
    // Only label BOUND systems; an unbound co-affected system must not leak.
    // A per-system PUBLIC label override wins over the raw catalog name (same
    // override path as the system-health widget), so the public detail page never
    // leaks an internal name inconsistently with the rest of the page.
    const names = await labelsFor(ctx, [...bound]);
    const labelOf = (id: string): string | undefined =>
      bound.has(id) ? (c.systemLabels[id] ?? names.get(id) ?? id) : undefined;
    const selected = [...active, ...past];
    // ONE bulk fetch of every selected incident's update timeline, instead of
    // an N+1 fan-out of `getIncident` per row. showUpdates=false still skips
    // the fetch entirely (perf). Each incident's updates are keyed by its id.
    const bulkUpdates = c.showUpdates
      ? await inc.getBulkIncidentUpdates({
          incidentIds: selected.map((i) => i.id),
        })
      : undefined;
    const updatesByIncident: Record<string, InternalUpdate[]> =
      bulkUpdates?.updates ?? {};
    const items = selected.map((i) => {
      const updates = latestUpdates(
        updatesByIncident[i.id] ?? [],
        c.maxUpdates,
      );
      const resolved = i.status === "resolved";
      return {
        id: i.id,
        title: i.title,
        status: i.status,
        severity: i.severity,
        systems: i.systemIds
          .map((id) => labelOf(id))
          .filter((l): l is string => l !== undefined),
        startedAt: iso(i.createdAt),
        ...(resolved ? { resolvedAt: iso(i.updatedAt) } : {}),
        updates,
      };
    });
    return IncidentsDtoSchema.parse({ incidents: items });
  },
  // Full detail for the individual incident page: the ONE incident's ALL public
  // updates (no `maxUpdates` cap) + its description. Scope-checked the same way
  // as resolvePublic; returns null for an out-of-scope / unknown id.
  async resolveDetail({ id, config, ctx }) {
    const c = IncidentsConfigSchema.parse(config);
    const bound = await effectiveScope(c, ctx);
    if (bound.size === 0) return null;
    const inc = ctx.rpcClient.forPlugin(IncidentApi);
    // includeResolved so a resolved incident's page still loads; the status-page
    // gate has already confirmed this id is surfaced by the page.
    const { incidents: all } = await inc.listIncidents({ includeResolved: true });
    const found = all.find(
      (i) => i.id === id && i.systemIds.some((s) => bound.has(s)),
    );
    if (!found) return null;
    const names = await labelsFor(ctx, [...bound]);
    const labelOf = (sid: string): string | undefined =>
      bound.has(sid) ? (c.systemLabels[sid] ?? names.get(sid) ?? sid) : undefined;
    const bulk = await inc.getBulkIncidentUpdates({ incidentIds: [id] });
    const updates = latestUpdates(bulk.updates?.[id] ?? []);
    const resolved = found.status === "resolved";
    return IncidentDtoItemSchema.parse({
      id: found.id,
      title: found.title,
      status: found.status,
      severity: found.severity,
      systems: found.systemIds
        .map((sid) => labelOf(sid))
        .filter((l): l is string => l !== undefined),
      startedAt: iso(found.createdAt),
      ...(resolved ? { resolvedAt: iso(found.updatedAt) } : {}),
      ...(found.description ? { description: found.description } : {}),
      updates,
    });
  },
};

/** Register the incident-owned status-page widget under the `statuspage.*` namespace. */
export function registerIncidentStatusWidgets(
  ext: StatusWidgetTypeExtensionPoint,
): void {
  ext.registerWidgetType(incidents, statusPagePluginMetadata);
}
