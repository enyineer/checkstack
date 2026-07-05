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
  statusBannerTitle,
} from "./rollup";

const SYSTEM_TYPE = "catalog.system";
const GROUP_TYPE = "catalog.group";

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

async function healthStatuses(
  ctx: WidgetResolveContext,
  ids: string[],
): Promise<Record<string, { status: string } | undefined>> {
  if (ids.length === 0) return {};
  const { statuses } = await ctx.rpcClient
    .forPlugin(HealthCheckApi)
    .getBulkSystemHealthStatus({ systemIds: ids });
  // Project to ONLY the derived status. `getBulkSystemHealthStatus` folds active
  // incident overrides into `status` (so the public page shows the forced
  // status), but the response also carries `override.reason` = the incident
  // TITLE. Status pages are public and incidents may be hidden, so we drop
  // everything but the status here - the incident name must never reach a public
  // widget DTO.
  const projected: Record<string, { status: string } | undefined> = {};
  for (const [systemId, value] of Object.entries(statuses)) {
    projected[systemId] = value ? { status: value.status } : undefined;
  }
  return projected;
}

function publicStatus({
  systemId,
  health,
  maint,
}: {
  systemId: string;
  health: Record<string, { status: string } | undefined>;
  maint: Set<string>;
}): PublicStatus {
  if (maint.has(systemId)) return "maintenance";
  const internal = health[systemId]?.status;
  return internal ? mapHealthStatus(internal) : "unknown";
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
  async resolvePublic({ config, ctx }) {
    const c = BannerConfigSchema.parse(config);
    const health = await healthStatuses(ctx, c.systemIds);
    const maint = await inMaintenance(ctx, c.systemIds);
    const status = overallBannerStatus(
      c.systemIds.map((systemId) => publicStatus({ systemId, health, maint })),
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
  async resolvePublic({ config, ctx }) {
    const c = SystemHealthConfigSchema.parse(config);
    const ids = c.items.map((i) => i.systemId);
    const health = await healthStatuses(ctx, ids);
    const maint = await inMaintenance(ctx, ids);
    const names = await labelsFor(ctx, ids);
    const uptime = c.showUptime ? await uptimeMap(ctx, ids) : undefined;
    const systems = c.items.map((item) => {
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
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const out = new Map<string, number>();
  const results = await Promise.allSettled(
    ids.map(async (systemId) => {
      const stats = await ctx.rpcClient
        .forPlugin(HealthCheckApi)
        .getRunStats({ systemId, startDate: start, endDate: end, maxBuckets: 1 });
      // No runs in the window => no uptime to report (don't surface a
      // misleading 0.00% for a system with no history).
      if (stats.total.runCount === 0) return null;
      return [systemId, stats.total.uptimePct] as const;
    }),
  );
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) out.set(r.value[0], r.value[1]);
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
  async resolvePublic({ config, ctx }) {
    const c = GroupStatusConfigSchema.parse(config);
    const groups = await allGroups(ctx);
    const group = groups.find((g) => g.id === c.groupId);
    const ids = group?.systemIds ?? [];
    const health = await healthStatuses(ctx, ids);
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
  async resolvePublic({ config, ctx }) {
    const c = UptimeConfigSchema.parse(config);
    const end = new Date();
    const start = new Date(end.getTime() - c.days * 86_400_000);
    const stats = await ctx.rpcClient.forPlugin(HealthCheckApi).getRunStats({
      systemId: c.systemId,
      startDate: start,
      endDate: end,
      maxBuckets: c.days,
    });
    const names = await labelsFor(ctx, [c.systemId]);
    return UptimeDtoSchema.parse({
      label: c.label ?? names.get(c.systemId) ?? c.systemId,
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
