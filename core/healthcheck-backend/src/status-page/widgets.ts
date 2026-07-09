import { CatalogApi, assertCatalogResourcesReadable } from "@checkstack/catalog-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import {
  pluginMetadata as statusPagePluginMetadata,
  BannerConfigSchema,
  BannerDtoSchema,
  SystemHealthConfigSchema,
  SystemHealthDtoSchema,
  GroupStatusConfigSchema,
  GroupStatusDtoSchema,
  UptimeConfigSchema,
  UptimeDtoSchema,
  type PublicStatus,
} from "@checkstack/status-page-common";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
  StatusWidgetTypeExtensionPoint,
} from "@checkstack/status-page-backend";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import type { RpcClient } from "@checkstack/backend-api";
import {
  mapHealthStatus,
  rollupStatus,
  overallBannerStatus,
  rollupSelectedEnvironments,
  statusBannerTitle,
} from "./rollup";

const SYSTEM_TYPE = "catalog.system";
const GROUP_TYPE = "catalog.group";

/**
 * The catalog system ids visible under the page's published-environment scope,
 * or null when the page publishes all environments (no filter). Resolved once
 * per page resolve (cache-keyed by the env set) from the catalog's own
 * env->systems mapping, so a system in NONE of the selected environments is
 * omitted from every health widget.
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
 * Restrict a widget's configured system ids to those visible under the page's
 * published-environment scope. Returns the ids unchanged when the page publishes
 * all environments.
 */
async function scopeToEnv(
  ctx: WidgetResolveContext,
  ids: string[],
): Promise<string[]> {
  const visible = await envVisibleSystems(ctx);
  if (!visible) return ids;
  return ids.filter((id) => visible.has(id));
}

/*
 * The CURRENT set of catalog system ids each health widget surfaces, resolved
 * from the SAME config the DTO resolve reads and intersected with the page's
 * published-environment scope. Shared by `resolvePublic` (what the widget shows)
 * and `resolveScopedSystems` / `resolveScopedSystemsDetailed` (what the
 * subscriber fan-out may email about), so the shown set and the emailed-about set
 * can never drift.
 */

async function bannerScopedIds(
  config: unknown,
  ctx: WidgetResolveContext,
): Promise<string[]> {
  return scopeToEnv(ctx, BannerConfigSchema.parse(config).systemIds);
}

async function systemHealthScopedItems(
  config: unknown,
  ctx: WidgetResolveContext,
) {
  const c = SystemHealthConfigSchema.parse(config);
  const visible = await envVisibleSystems(ctx);
  return visible ? c.items.filter((i) => visible.has(i.systemId)) : c.items;
}

async function groupStatusScopedIds(
  config: unknown,
  ctx: WidgetResolveContext,
): Promise<string[]> {
  const c = GroupStatusConfigSchema.parse(config);
  const groups = await allGroups(ctx);
  const group = groups.find((g) => g.id === c.groupId);
  return scopeToEnv(ctx, group?.systemIds ?? []);
}

async function uptimeScopedIds(
  config: unknown,
  ctx: WidgetResolveContext,
): Promise<string[]> {
  return scopeToEnv(ctx, [UptimeConfigSchema.parse(config).systemId]);
}

function uptimeToStatus(pct: number): PublicStatus {
  if (pct >= 99.5) return "operational";
  if (pct >= 95) return "degraded";
  return "major_outage";
}

/** All systems' id -> name, fetched once per page resolve. */
function systemNames(ctx: WidgetResolveContext): Promise<Map<string, string>> {
  return ctx.cache("catalog.systemNames", async () => {
    const { systems } = await ctx.rpcClient.forPlugin(CatalogApi).getSystems();
    return new Map(systems.map((s) => [s.id, s.name]));
  });
}

/** All catalog groups, fetched once per page resolve. */
function allGroups(
  ctx: WidgetResolveContext,
): Promise<Array<{ id: string; name: string; systemIds: string[] }>> {
  return ctx.cache("catalog.groups", async () => {
    const groups = await ctx.rpcClient.forPlugin(CatalogApi).getGroups();
    return groups.map((g) => ({ id: g.id, name: g.name, systemIds: g.systemIds }));
  });
}

async function labelsFor(
  ctx: WidgetResolveContext,
  ids: string[],
): Promise<Map<string, string>> {
  const all = await systemNames(ctx);
  const out = new Map<string, string>();
  for (const id of ids) {
    const name = all.get(id);
    if (name !== undefined) out.set(id, name);
  }
  return out;
}

async function inMaintenance(
  ctx: WidgetResolveContext,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { maintenances } = await ctx.rpcClient
    .forPlugin(MaintenanceApi)
    .getBulkMaintenancesForSystems({ systemIds: ids });
  const out = new Set<string>();
  for (const id of ids) {
    if ((maintenances[id] ?? []).some((m) => m.status === "in_progress")) {
      out.add(id);
    }
  }
  return out;
}

/**
 * Per-system HEALTH-derived PUBLIC status (before the maintenance override).
 *
 * - Page publishes ALL environments: the cross-environment rollup via
 *   `getBulkSystemHealthStatus`, which folds active incident overrides into the
 *   status (so the public page shows the forced status).
 * - Page publishes a SPECIFIC environment set: the per-environment matrix rolled
 *   up over ONLY the selected environments (`rollupSelectedEnvironments`), then
 *   the whole-system incident override folded IN via worst-wins. Incident
 *   overrides are whole-system (not env-scoped), so they must apply regardless of
 *   which environments the page publishes - otherwise a system whose checks are
 *   green in the selected env but which is under an active incident-forced outage
 *   would wrongly read healthy. The override status comes from the SAME source as
 *   the all-env path (`getBulkSystemHealthStatus`, which folds it and surfaces it
 *   on `override`), so both modes show the identical forced status.
 *
 * In BOTH modes only the derived status enum is read - never `override.reason`
 * (the incident TITLE) or per-check detail - so no internal name reaches a
 * public widget DTO.
 */
async function healthPublicStatuses(
  ctx: WidgetResolveContext,
  ids: string[],
): Promise<Map<string, PublicStatus>> {
  const out = new Map<string, PublicStatus>();
  if (ids.length === 0) return out;
  const envIds = ctx.publishedEnvironmentIds;
  if (envIds && envIds.length > 0) {
    const client = ctx.rpcClient.forPlugin(HealthCheckApi);
    // Matrix = per-environment CHECKS status; bulk status carries the
    // whole-system incident override (on `override`). Fetch both, roll up only
    // the selected envs' checks, then fold the override in (worst-wins).
    const [matrixRes, bulkRes] = await Promise.all([
      client.getBulkSystemHealthMatrix({ systemIds: ids }),
      client.getBulkSystemHealthStatus({ systemIds: ids }),
    ]);
    for (const id of ids) {
      const matrix = matrixRes.statuses[id];
      const envChecks: PublicStatus = matrix
        ? rollupSelectedEnvironments({
            environments: matrix.environments,
            selectedEnvironmentIds: envIds,
          })
        : "unknown";
      const overrideStatus = bulkRes.statuses[id]?.override?.status;
      // rollupStatus is worst-wins over the public vocabulary, so the override
      // lifts the status exactly as `applySystemHealthOverrides` does upstream.
      out.set(
        id,
        overrideStatus
          ? rollupStatus([envChecks, mapHealthStatus(overrideStatus)])
          : envChecks,
      );
    }
    return out;
  }
  const { statuses } = await ctx.rpcClient
    .forPlugin(HealthCheckApi)
    .getBulkSystemHealthStatus({ systemIds: ids });
  for (const [systemId, value] of Object.entries(statuses)) {
    if (value) out.set(systemId, mapHealthStatus(value.status));
  }
  return out;
}

function publicStatus({
  systemId,
  health,
  maint,
}: {
  systemId: string;
  health: Map<string, PublicStatus>;
  maint: Set<string>;
}): PublicStatus {
  if (maint.has(systemId)) return "maintenance";
  return health.get(systemId) ?? "unknown";
}

/** assertBindingsReadable for system-bound widgets. */
const assertSystems =
  (getIds: (config: unknown) => { systemIds?: string[]; groupIds?: string[] }) =>
  async ({ userClient, config }: { userClient: RpcClient; config: unknown }) => {
    const { systemIds, groupIds } = getIds(config);
    await assertCatalogResourcesReadable({
      client: userClient.forPlugin(CatalogApi),
      systemIds,
      groupIds,
    });
  };

const banner: WidgetTypeDefinition = {
  id: "banner",
  displayName: "Status banner",
  description: "Overall status rolled up from the selected systems.",
  category: "Status",
  binding: "systems",
  configSchema: BannerConfigSchema,
  dtoSchema: BannerDtoSchema,
  boundResources: (config) =>
    BannerConfigSchema.parse(config).systemIds.map((id) => ({
      resourceType: SYSTEM_TYPE,
      resourceId: id,
    })),
  assertBindingsReadable: assertSystems((c) => ({
    systemIds: BannerConfigSchema.parse(c).systemIds,
  })),
  subscriptionCategory: "health",
  resolveScopedSystems: async ({ config, ctx }) =>
    new Set(await bannerScopedIds(config, ctx)),
  async resolveScopedSystemsDetailed({ config, ctx }) {
    const ids = await bannerScopedIds(config, ctx);
    const names = await labelsFor(ctx, ids);
    return ids.map((id) => ({ id, name: names.get(id) ?? id }));
  },
  async resolvePublic({ config, ctx }) {
    const c = BannerConfigSchema.parse(config);
    // Omit systems outside the page's published environments before rolling up.
    const ids = await bannerScopedIds(config, ctx);
    const health = await healthPublicStatuses(ctx, ids);
    const maint = await inMaintenance(ctx, ids);
    const status = overallBannerStatus(
      ids.map((systemId) => publicStatus({ systemId, health, maint })),
    );
    return BannerDtoSchema.parse({
      status,
      title: c.title ?? statusBannerTitle(status),
    });
  },
};

const systemHealth: WidgetTypeDefinition = {
  id: "systemHealth",
  displayName: "System health",
  description: "A status row per selected system.",
  category: "Status",
  binding: "systems",
  configSchema: SystemHealthConfigSchema,
  dtoSchema: SystemHealthDtoSchema,
  boundResources: (config) =>
    SystemHealthConfigSchema.parse(config).items.map((i) => ({
      resourceType: SYSTEM_TYPE,
      resourceId: i.systemId,
    })),
  assertBindingsReadable: assertSystems((c) => ({
    systemIds: SystemHealthConfigSchema.parse(c).items.map((i) => i.systemId),
  })),
  subscriptionCategory: "health",
  async resolveScopedSystems({ config, ctx }) {
    const items = await systemHealthScopedItems(config, ctx);
    return new Set(items.map((i) => i.systemId));
  },
  async resolveScopedSystemsDetailed({ config, ctx }) {
    const items = await systemHealthScopedItems(config, ctx);
    const names = await labelsFor(
      ctx,
      items.map((i) => i.systemId),
    );
    return items.map((i) => ({
      id: i.systemId,
      name: i.label ?? names.get(i.systemId) ?? i.systemId,
    }));
  },
  async resolvePublic({ config, ctx }) {
    const c = SystemHealthConfigSchema.parse(config);
    // Drop rows for systems outside the page's published environments.
    const items = await systemHealthScopedItems(config, ctx);
    const ids = items.map((i) => i.systemId);
    const health = await healthPublicStatuses(ctx, ids);
    const maint = await inMaintenance(ctx, ids);
    const names = await labelsFor(ctx, ids);
    const uptime = c.showUptime ? await uptimeMap(ctx, ids) : undefined;
    const systems = items.map((item) => {
      const pct = uptime?.get(item.systemId);
      return {
        label: item.label ?? names.get(item.systemId) ?? item.systemId,
        status: publicStatus({ systemId: item.systemId, health, maint }),
        ...(pct === undefined ? {} : { uptimePct: pct }),
      };
    });
    return SystemHealthDtoSchema.parse({ systems });
  },
};

async function uptimeMap(
  ctx: WidgetResolveContext,
  ids: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  // ONE bulk call for every system's uptime, instead of an N+1 fan-out of
  // per-system `getRunStats` (each holding a pooled connection). Systems with
  // no runs are omitted from `stats`, so they never enter the map - preserving
  // the previous "no runs => no misleading 0.00%" behavior exactly. When the
  // page publishes a specific environment set, uptime counts only runs in those
  // environments (env-less runs excluded).
  const { stats } = await ctx.rpcClient
    .forPlugin(HealthCheckApi)
    .getBulkRunStats({
      systemIds: ids,
      startDate: start,
      endDate: end,
      ...(ctx.publishedEnvironmentIds
        ? { environmentIds: ctx.publishedEnvironmentIds }
        : {}),
      maxBuckets: 1,
    });
  for (const systemId of ids) {
    const s = stats[systemId];
    if (s && s.total.runCount > 0) out.set(systemId, s.total.uptimePct);
  }
  return out;
}

const groupStatus: WidgetTypeDefinition = {
  id: "groupStatus",
  displayName: "Group status",
  description: "Rolled-up status of every system in a catalog group.",
  category: "Status",
  binding: "group",
  configSchema: GroupStatusConfigSchema,
  dtoSchema: GroupStatusDtoSchema,
  boundResources: (config) => [
    { resourceType: GROUP_TYPE, resourceId: GroupStatusConfigSchema.parse(config).groupId },
  ],
  assertBindingsReadable: assertSystems((c) => ({
    groupIds: [GroupStatusConfigSchema.parse(c).groupId],
  })),
  subscriptionCategory: "health",
  resolveScopedSystems: async ({ config, ctx }) =>
    new Set(await groupStatusScopedIds(config, ctx)),
  async resolveScopedSystemsDetailed({ config, ctx }) {
    const ids = await groupStatusScopedIds(config, ctx);
    const names = await labelsFor(ctx, ids);
    return ids.map((id) => ({ id, name: names.get(id) ?? id }));
  },
  async resolvePublic({ config, ctx }) {
    const c = GroupStatusConfigSchema.parse(config);
    const groups = await allGroups(ctx);
    const group = groups.find((g) => g.id === c.groupId);
    // Omit group members outside the page's published environments.
    const ids = await groupStatusScopedIds(config, ctx);
    const health = await healthPublicStatuses(ctx, ids);
    const maint = await inMaintenance(ctx, ids);
    const names = await labelsFor(ctx, ids);
    const systems = ids.map((systemId) => ({
      label: names.get(systemId) ?? systemId,
      status: publicStatus({ systemId, health, maint }),
    }));
    return GroupStatusDtoSchema.parse({
      label: c.label ?? group?.name ?? "Group",
      status: rollupStatus(systems.map((s) => s.status)),
      systems,
      collapseWhenHealthy: c.collapseWhenHealthy,
    });
  },
};

const uptime: WidgetTypeDefinition = {
  id: "uptime",
  displayName: "Uptime history",
  description: "A daily uptime bar chart for one system.",
  category: "Status",
  binding: "system",
  configSchema: UptimeConfigSchema,
  dtoSchema: UptimeDtoSchema,
  boundResources: (config) => [
    { resourceType: SYSTEM_TYPE, resourceId: UptimeConfigSchema.parse(config).systemId },
  ],
  assertBindingsReadable: assertSystems((c) => ({
    systemIds: [UptimeConfigSchema.parse(c).systemId],
  })),
  subscriptionCategory: "health",
  resolveScopedSystems: async ({ config, ctx }) =>
    new Set(await uptimeScopedIds(config, ctx)),
  async resolveScopedSystemsDetailed({ config, ctx }) {
    const c = UptimeConfigSchema.parse(config);
    const ids = await uptimeScopedIds(config, ctx);
    if (ids.length === 0) return [];
    const names = await labelsFor(ctx, ids);
    return ids.map((id) => ({ id, name: c.label ?? names.get(id) ?? id }));
  },
  async resolvePublic({ config, ctx }) {
    const c = UptimeConfigSchema.parse(config);
    const names = await labelsFor(ctx, [c.systemId]);
    const label = c.label ?? names.get(c.systemId) ?? c.systemId;
    // Omit this system's uptime when it is outside the page's published
    // environments: emit the blank empty-state DTO (empty bars) the sibling
    // health widgets use for out-of-scope systems, so the single-system uptime
    // widget never shows misleading or stale-environment uptime. Gated on the
    // CURRENT catalog env membership (`envVisibleSystems`), NOT on "getRunStats
    // returned nothing" - so a system removed from the published env but still
    // carrying old env-tagged runs is correctly blanked. No env filter (visible
    // is null) leaves behavior unchanged.
    const visible = await envVisibleSystems(ctx);
    if (visible && !visible.has(c.systemId)) {
      return UptimeDtoSchema.parse({ label, uptimePct: 0, bars: [] });
    }
    const end = new Date();
    const start = new Date(end.getTime() - c.days * 86_400_000);
    const stats = await ctx.rpcClient.forPlugin(HealthCheckApi).getRunStats({
      systemId: c.systemId,
      startDate: start,
      endDate: end,
      // Scope uptime to the page's published environments when set.
      ...(ctx.publishedEnvironmentIds
        ? { environmentIds: ctx.publishedEnvironmentIds }
        : {}),
      maxBuckets: c.days,
    });
    return UptimeDtoSchema.parse({
      label,
      uptimePct: stats.total.uptimePct,
      bars: stats.buckets.map((b) => ({
        date: b.start,
        uptimePct: b.uptimePct,
        status: uptimeToStatus(b.uptimePct),
      })),
    });
  },
};

/** Register the health-owned status-page widgets under the `statuspage.*` namespace. */
export function registerHealthcheckStatusWidgets(
  ext: StatusWidgetTypeExtensionPoint,
): void {
  for (const w of [banner, systemHealth, groupStatus, uptime]) {
    ext.registerWidgetType(w, statusPagePluginMetadata);
  }
}
