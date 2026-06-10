import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { IncidentApi } from "@checkstack/incident-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import {
  pluginMetadata,
  BannerConfigSchema,
  BannerDtoSchema,
  SystemHealthConfigSchema,
  SystemHealthDtoSchema,
  GroupStatusConfigSchema,
  GroupStatusDtoSchema,
  UptimeConfigSchema,
  UptimeDtoSchema,
  IncidentsConfigSchema,
  IncidentsDtoSchema,
  MaintenanceConfigSchema,
  MaintenanceDtoSchema,
  TextConfigSchema,
  TextDtoSchema,
  HeadingConfigSchema,
  HeadingDtoSchema,
  LinksConfigSchema,
  LinksDtoSchema,
  ImageConfigSchema,
  ImageDtoSchema,
  DividerConfigSchema,
  DividerDtoSchema,
  type PublicStatus,
} from "@checkstack/status-page-common";
import type { RpcClient } from "@checkstack/backend-api";
import {
  mapHealthStatus,
  rollupStatus,
  overallBannerStatus,
  statusBannerTitle,
} from "./rollup.logic";
import { toPublicIncident, toPublicMaintenance } from "./public-dto.logic";
import type {
  WidgetResolveContext,
  WidgetTypeDefinition,
  WidgetTypeRegistry,
} from "./widget-registry";

const SYSTEM_TYPE = "catalog.system";
const GROUP_TYPE = "catalog.group";

/** Map a 0-100 uptime % to a public status (drives uptime bar coloring). */
function uptimeToStatus(pct: number): PublicStatus {
  if (pct >= 99.5) return "operational";
  if (pct >= 95) return "degraded";
  return "major_outage";
}

/** Resolve system ids -> public label (their catalog name), via the memoized
 *  per-resolve name map (so the catalog is scanned once per page, not per widget). */
async function fetchSystemNames(
  ctx: WidgetResolveContext,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const all = await ctx.systemNames();
  const out = new Map<string, string>();
  for (const id of ids) {
    const name = all.get(id);
    if (name !== undefined) out.set(id, name);
  }
  return out;
}

/** System ids that have an in-progress maintenance right now (trusted read). */
async function fetchInMaintenance(
  rpcClient: RpcClient,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { maintenances } = await rpcClient
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

/** Resolve a system's public status (maintenance overlay wins over health). */
function systemPublicStatus({
  systemId,
  healthStatuses,
  inMaintenance,
}: {
  systemId: string;
  healthStatuses: Record<string, { status: string } | undefined>;
  inMaintenance: Set<string>;
}): PublicStatus {
  if (inMaintenance.has(systemId)) return "maintenance";
  const internal = healthStatuses[systemId]?.status;
  return internal ? mapHealthStatus(internal) : "unknown";
}

const banner: WidgetTypeDefinition = {
  id: "banner",
  displayName: "Status banner",
  description: "Overall status rolled up from the selected systems.",
  category: "Status",
  binding: "systems",
  configSchema: BannerConfigSchema,
  dtoSchema: BannerDtoSchema,
  boundResources(config) {
    const c = BannerConfigSchema.parse(config);
    return c.systemIds.map((id) => ({ resourceType: SYSTEM_TYPE, resourceId: id }));
  },
  async resolvePublic({ config, ctx }) {
    const c = BannerConfigSchema.parse(config);
    const ids = c.systemIds;
    const { statuses } = ids.length > 0
      ? await ctx.rpcClient
          .forPlugin(HealthCheckApi)
          .getBulkSystemHealthStatus({ systemIds: ids })
      : { statuses: {} };
    const inMaint = await fetchInMaintenance(ctx.rpcClient, ids);
    const status = overallBannerStatus(
      ids.map((systemId) =>
        systemPublicStatus({ systemId, healthStatuses: statuses, inMaintenance: inMaint }),
      ),
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
  boundResources(config) {
    const c = SystemHealthConfigSchema.parse(config);
    return c.items.map((i) => ({ resourceType: SYSTEM_TYPE, resourceId: i.systemId }));
  },
  async resolvePublic({ config, ctx }) {
    const c = SystemHealthConfigSchema.parse(config);
    const ids = c.items.map((i) => i.systemId);
    const { statuses } = ids.length > 0
      ? await ctx.rpcClient
          .forPlugin(HealthCheckApi)
          .getBulkSystemHealthStatus({ systemIds: ids })
      : { statuses: {} };
    const inMaint = await fetchInMaintenance(ctx.rpcClient, ids);
    const names = await fetchSystemNames(ctx, ids);
    const uptime = c.showUptime
      ? await fetchUptimeMap(ctx, ids)
      : undefined;
    const systems = c.items.map((item) => {
      const status = systemPublicStatus({
        systemId: item.systemId,
        healthStatuses: statuses,
        inMaintenance: inMaint,
      });
      const pct = uptime?.get(item.systemId);
      return {
        label: item.label ?? names.get(item.systemId) ?? item.systemId,
        status,
        ...(pct === undefined ? {} : { uptimePct: pct }),
      };
    });
    return SystemHealthDtoSchema.parse({ systems });
  },
};

/** 30-day uptime % per system (trusted read; for the optional showUptime). */
async function fetchUptimeMap(
  ctx: WidgetResolveContext,
  ids: string[],
): Promise<Map<string, number>> {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const out = new Map<string, number>();
  // allSettled: one system with no health data must not blank the whole column.
  const results = await Promise.allSettled(
    ids.map(async (systemId) => {
      const stats = await ctx.rpcClient
        .forPlugin(HealthCheckApi)
        .getRunStats({ systemId, startDate: start, endDate: end, maxBuckets: 1 });
      return [systemId, stats.total.uptimePct] as const;
    }),
  );
  for (const r of results) {
    if (r.status === "fulfilled") out.set(r.value[0], r.value[1]);
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
  boundResources(config) {
    const c = GroupStatusConfigSchema.parse(config);
    return [{ resourceType: GROUP_TYPE, resourceId: c.groupId }];
  },
  async resolvePublic({ config, ctx }) {
    const c = GroupStatusConfigSchema.parse(config);
    const groups = await ctx.groups();
    const group = groups.find((g) => g.id === c.groupId);
    const ids = group?.systemIds ?? [];
    const { statuses } = ids.length > 0
      ? await ctx.rpcClient
          .forPlugin(HealthCheckApi)
          .getBulkSystemHealthStatus({ systemIds: ids })
      : { statuses: {} };
    const inMaint = await fetchInMaintenance(ctx.rpcClient, ids);
    const names = await fetchSystemNames(ctx, ids);
    const systems = ids.map((systemId) => ({
      label: names.get(systemId) ?? systemId,
      status: systemPublicStatus({ systemId, healthStatuses: statuses, inMaintenance: inMaint }),
    }));
    const status = rollupStatus(systems.map((s) => s.status));
    return GroupStatusDtoSchema.parse({
      label: c.label ?? group?.name ?? "Group",
      status,
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
  boundResources(config) {
    const c = UptimeConfigSchema.parse(config);
    return [{ resourceType: SYSTEM_TYPE, resourceId: c.systemId }];
  },
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
    const names = await fetchSystemNames(ctx, [c.systemId]);
    const bars = stats.buckets.map((b) => ({
      date: b.start,
      uptimePct: b.uptimePct,
      status: uptimeToStatus(b.uptimePct),
    }));
    return UptimeDtoSchema.parse({
      label: c.label ?? names.get(c.systemId) ?? c.systemId,
      uptimePct: stats.total.uptimePct,
      bars,
    });
  },
};

const incidents: WidgetTypeDefinition = {
  id: "incidents",
  displayName: "Incidents",
  description: "Recent unresolved incidents with their update timeline.",
  category: "Events",
  binding: "systems",
  configSchema: IncidentsConfigSchema,
  dtoSchema: IncidentsDtoSchema,
  boundResources(config) {
    const c = IncidentsConfigSchema.parse(config);
    return c.systemIds.map((id) => ({ resourceType: SYSTEM_TYPE, resourceId: id }));
  },
  async resolvePublic({ config, ctx }) {
    const c = IncidentsConfigSchema.parse(config);
    const bound = new Set(c.systemIds);
    // FAIL CLOSED: with no systems bound there is nothing the operator chose to
    // expose. Never fall back to "all incidents" — as a trusted service caller
    // that would publish every incident on the platform (S1). The widget shows
    // nothing until the operator binds the systems it should cover.
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
    // Only label BOUND systems (an unbound co-affected system must not leak).
    const names = await fetchSystemNames(ctx, [...bound]);
    const items = await Promise.allSettled(
      sorted.map(async (i) => {
        const detail = await inc.getIncident({ id: i.id });
        return toPublicIncident({
          incident: {
            id: i.id,
            title: i.title,
            status: i.status,
            severity: i.severity,
            systemIds: i.systemIds,
            createdAt: i.createdAt,
            updates: detail?.updates ?? [],
          },
          systemLabels: names,
        });
      }),
    );
    return IncidentsDtoSchema.parse({
      incidents: items
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value),
    });
  },
};

const maintenance: WidgetTypeDefinition = {
  id: "maintenance",
  displayName: "Scheduled maintenance",
  description: "Upcoming and in-progress maintenance windows.",
  category: "Events",
  binding: "systems",
  configSchema: MaintenanceConfigSchema,
  dtoSchema: MaintenanceDtoSchema,
  boundResources(config) {
    const c = MaintenanceConfigSchema.parse(config);
    return c.systemIds.map((id) => ({ resourceType: SYSTEM_TYPE, resourceId: id }));
  },
  async resolvePublic({ config, ctx }) {
    const c = MaintenanceConfigSchema.parse(config);
    const bound = new Set(c.systemIds);
    // FAIL CLOSED (see incidents): no systems bound -> expose nothing, never
    // "all maintenances on the platform".
    if (bound.size === 0) {
      return MaintenanceDtoSchema.parse({ maintenances: [] });
    }
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
    const names = await fetchSystemNames(ctx, [...bound]);
    const items = await Promise.allSettled(
      sorted.map(async (m) => {
        const detail = await mc.getMaintenance({ id: m.id });
        return toPublicMaintenance({
          maintenance: {
            id: m.id,
            title: m.title,
            status: m.status,
            startAt: m.startAt,
            endAt: m.endAt,
            systemIds: m.systemIds,
            updates: detail?.updates ?? [],
          },
          systemLabels: names,
        });
      }),
    );
    return MaintenanceDtoSchema.parse({
      maintenances: items
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value),
    });
  },
};

/** A static widget: its config IS its public DTO (no resource reads). */
function staticWidget({
  id,
  displayName,
  description,
  configSchema,
  dtoSchema,
}: {
  id: string;
  displayName: string;
  description: string;
  configSchema: WidgetTypeDefinition["configSchema"];
  dtoSchema: WidgetTypeDefinition["dtoSchema"];
}): WidgetTypeDefinition {
  return {
    id,
    displayName,
    description,
    category: "Content",
    binding: "none",
    configSchema,
    dtoSchema,
    boundResources: () => [],
    async resolvePublic({ config }) {
      return dtoSchema.parse(configSchema.parse(config));
    },
  };
}

/** Register the built-in widget types into the registry. */
export function registerBuiltinWidgets(registry: WidgetTypeRegistry): void {
  const builtins: WidgetTypeDefinition[] = [
    banner,
    systemHealth,
    groupStatus,
    uptime,
    incidents,
    maintenance,
    staticWidget({
      id: "text",
      displayName: "Text",
      description: "A Markdown text block (rendered sanitized).",
      configSchema: TextConfigSchema,
      dtoSchema: TextDtoSchema,
    }),
    staticWidget({
      id: "heading",
      displayName: "Heading",
      description: "A section heading.",
      configSchema: HeadingConfigSchema,
      dtoSchema: HeadingDtoSchema,
    }),
    staticWidget({
      id: "links",
      displayName: "Links",
      description: "A list of labelled links.",
      configSchema: LinksConfigSchema,
      dtoSchema: LinksDtoSchema,
    }),
    staticWidget({
      id: "image",
      displayName: "Image / logo",
      description: "An image (e.g. your logo).",
      configSchema: ImageConfigSchema,
      dtoSchema: ImageDtoSchema,
    }),
    staticWidget({
      id: "divider",
      displayName: "Divider",
      description: "A horizontal divider.",
      configSchema: DividerConfigSchema,
      dtoSchema: DividerDtoSchema,
    }),
  ];
  for (const w of builtins) registry.register(w, pluginMetadata);
}
