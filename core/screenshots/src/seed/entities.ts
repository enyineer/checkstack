import type { CheckstackClient } from "@checkstack/sdk";
import {
  DEPENDENCIES,
  ENVIRONMENTS,
  GROUPS,
  NODE_POSITIONS,
  SYSTEMS,
  type HealthProfile,
} from "../scenario.ts";
import type { SeedRefs } from "./types.ts";

/**
 * A health check that was created and assigned to a system, carrying exactly
 * the fields `history.ts` needs to synthesize matching runs/aggregates.
 */
export interface RunnableCheck {
  configurationId: string;
  systemId: string;
  /** Resolved environment ids the check fans out over (never empty here). */
  environmentIds: string[];
  healthProfile: HealthProfile;
  baseLatencyMs: number;
  intervalSeconds: number;
  /** Namespaced strategy id, so history can shape a strategy-appropriate run result. */
  strategyId: string;
}

/** SLO objectives created, for history synthesis (downtime events/snapshots). */
export interface RunnableSlo {
  sloId: string;
  systemId: string;
  target: number;
  windowDays: number;
}

/** A live AI integration connection the AI-chat DB seeder attaches a chat to. */
export interface AiIntegrationSeed {
  integrationId: string;
  model: string;
}

/** A representative system the in-app notification seeder builds cards around. */
export interface NotificationSystem {
  id: string;
  name: string;
}

export interface SeedResult {
  /**
   * Refs known at entity-creation time. `historyRunId` is filled in later, from
   * the synthesized runs in the DB phase, so it is omitted here.
   */
  refs: Omit<SeedRefs, "historyRunId">;
  checks: RunnableCheck[];
  slos: RunnableSlo[];
  /** The seeded admin's user id - owner of the seeded chat and notifications. */
  adminUserId: string;
  aiIntegration: AiIntegrationSeed;
  notificationSystems: NotificationSystem[];
}

/**
 * Create the entire demo world through the API, in dependency order, and return
 * the ids the history synthesizer and capturer need.
 *
 * Ordering: environments + groups first, then systems (joined to both), then
 * checks (create-and-assign), SLOs, dependencies, and finally the standalone
 * surfaces (incident, maintenance, satellites, announcements, automation,
 * notifications, applications, teams). Everything runs as the seeded admin.
 */
export async function seedEntities({
  client,
}: {
  client: CheckstackClient;
}): Promise<SeedResult> {
  const envIdByName = new Map<string, string>();
  for (const env of ENVIRONMENTS) {
    const created = await client.catalog.createEnvironment({
      name: env.name,
      description: env.description,
      metadata: { region: env.region },
    });
    envIdByName.set(env.name, created.id);
  }

  const groupIdByName = new Map<string, string>();
  for (const name of GROUPS) {
    const created = await client.catalog.createGroup({ name, metadata: {} });
    groupIdByName.set(name, created.id);
  }

  const systemIdByKey = new Map<string, string>();
  const systemNameById = new Map<string, string>();
  const checks: RunnableCheck[] = [];
  const slos: RunnableSlo[] = [];

  for (const spec of SYSTEMS) {
    const system = await client.catalog.createSystem({
      name: spec.name,
      description: spec.description,
      metadata: spec.metadata,
    });
    systemIdByKey.set(spec.key, system.id);
    systemNameById.set(system.id, spec.name);

    const groupId = groupIdByName.get(spec.group);
    if (groupId) {
      await client.catalog.addSystemToGroup({ groupId, systemId: system.id });
    }
    const environmentIds = spec.environments.flatMap((name) => {
      const id = envIdByName.get(name);
      return id ? [id] : [];
    });
    await client.catalog.setSystemEnvironments({
      systemId: system.id,
      environmentIds,
    });

    let firstConfigId: string | undefined;
    for (const check of spec.checks) {
      const cfg = await client.healthcheck.createAndAssign({
        configuration: {
          name: check.name,
          strategyId: check.strategyId,
          config: check.config,
          intervalSeconds: check.intervalSeconds,
          collectors: check.collectors?.map((collector) => ({
            id: crypto.randomUUID(),
            collectorId: collector.collectorId,
            config: collector.config,
            assertions: collector.assertions,
          })),
        },
        systemId: system.id,
        // Create DISABLED so createAndAssign does not schedule an immediate live
        // run: the strategies are really registered now, so a live run would
        // probe fake hosts (db.internal, cache.internal, ...) and crash the
        // hermetic backend. The seed flips `enabled` back on in the DB afterwards
        // (seed/index.ts) so the UI shows enabled checks without ever probing.
        enabled: false,
      });
      firstConfigId ??= cfg.id;
      checks.push({
        configurationId: cfg.id,
        systemId: system.id,
        environmentIds,
        healthProfile: check.healthProfile,
        baseLatencyMs: check.baseLatencyMs,
        intervalSeconds: check.intervalSeconds,
        strategyId: check.strategyId,
      });
    }

    if (spec.slo && firstConfigId) {
      const slo = await client.slo.createObjective({
        systemId: system.id,
        healthCheckConfigurationId: firstConfigId,
        target: spec.slo.target,
        windowDays: spec.slo.windowDays,
        dependencyExclusion: "strict",
      });
      slos.push({
        sloId: slo.id,
        systemId: system.id,
        target: spec.slo.target,
        windowDays: spec.slo.windowDays,
      });
    }
  }

  for (const dep of DEPENDENCIES) {
    const sourceSystemId = systemIdByKey.get(dep.source);
    const targetSystemId = systemIdByKey.get(dep.target);
    if (!sourceSystemId || !targetSystemId) continue;
    await client.dependency.createDependency({
      sourceSystemId,
      targetSystemId,
      impactType: dep.impactType,
      label: dep.label,
    });
  }

  // Persist a clean left-to-right layered layout so the dependency map renders
  // an ordered DAG instead of the default edge-agnostic grid. Positions are
  // per-user; the capture browser logs in as this same admin, so the saved
  // layout is what `getNodePositions` returns for the screenshot session.
  const positions = [...systemIdByKey].flatMap(([key, systemId]) => {
    const pos = NODE_POSITIONS[key];
    return pos ? [{ systemId, x: pos.x, y: pos.y }] : [];
  });
  if (positions.length > 0) {
    await client.dependency.saveNodePositions({ positions });
  }

  const checkoutId = systemIdByKey.get("checkout-api");
  const paymentsId = systemIdByKey.get("payments-service");
  if (!checkoutId || !paymentsId) {
    throw new Error("Scenario invariant broken: flagship systems missing");
  }

  const incidentId = await seedIncidents({ client, checkoutId, paymentsId });
  const maintenanceId = await seedMaintenance({
    client,
    systemId: systemIdByKey.get("postgres-primary") ?? checkoutId,
  });
  await seedSatellites({ client });
  await seedAnnouncements({ client });
  await seedAutomation({ client });
  await seedNotifications({ client });
  await seedApplications({ client });
  await seedTeams({ client });
  await seedGitOps({ client });
  const aiIntegration = await seedAiIntegration({ client });
  const profile = await client.auth.getCurrentUserProfile();

  const flagshipCheck = checks.find((c) => c.systemId === checkoutId);
  const flagshipSlo = slos.find((s) => s.systemId === checkoutId);
  if (!flagshipCheck || !flagshipSlo) {
    throw new Error("Scenario invariant broken: flagship check/SLO missing");
  }

  // A few representative systems the in-app notification cards reference as
  // chips. Ordered flagship-first so the richest example leads the list.
  const notificationSystems = [
    "checkout-api",
    "payments-service",
    "postgres-primary",
    "web-storefront",
  ].flatMap((key) => {
    const id = systemIdByKey.get(key);
    const name = id ? systemNameById.get(id) : undefined;
    return id && name ? [{ id, name }] : [];
  });

  return {
    refs: {
      systemId: checkoutId,
      configurationId: flagshipCheck.configurationId,
      sloId: flagshipSlo.sloId,
      incidentId,
      maintenanceId,
    },
    checks,
    slos,
    adminUserId: profile.id,
    aiIntegration,
    notificationSystems,
  };
}

/**
 * Create one OpenAI-compatible AI integration connection so the chat page is not
 * gated behind the "No AI integration configured" empty state. No real API call
 * is ever made - rendering a persisted transcript never calls the model - so a
 * dummy key with a set default model is enough for the connection to be listed.
 */
async function seedAiIntegration({
  client,
}: {
  client: CheckstackClient;
}): Promise<AiIntegrationSeed> {
  const model = "gpt-4o-mini";
  const connection = await client.integration.createConnection({
    providerId: "ai.openai-compatible",
    name: "OpenAI (demo)",
    config: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-demo-not-a-real-key",
      defaultModel: model,
    },
  });
  return { integrationId: connection.id, model };
}

async function seedIncidents({
  client,
  checkoutId,
  paymentsId,
}: {
  client: CheckstackClient;
  checkoutId: string;
  paymentsId: string;
}): Promise<string> {
  // A resolved historic incident for the list, and one active for the timeline.
  const resolved = await client.incident.createIncident({
    title: "Elevated latency on search",
    description: "Search P95 crossed 1s after an index rebuild.",
    severity: "minor",
    systemIds: [paymentsId],
    initialMessage: "Investigating elevated search latency.",
  });
  await client.incident.addUpdate({
    incidentId: resolved.id,
    message: "Index rebuild completed; latency back to baseline.",
    statusChange: "resolved",
  });

  const active = await client.incident.createIncident({
    title: "Checkout returning 5xx for a subset of carts",
    description:
      "A payments dependency is degraded, causing intermittent 500s on checkout submit.",
    severity: "major",
    systemIds: [checkoutId, paymentsId],
    initialMessage: "We are investigating elevated error rates on checkout.",
  });
  await client.incident.addUpdate({
    incidentId: active.id,
    message: "Root cause traced to the payments gRPC service. Failing over.",
    statusChange: "identified",
  });
  return active.id;
}

async function seedMaintenance({
  client,
  systemId,
}: {
  client: CheckstackClient;
  systemId: string;
}): Promise<string> {
  const day = 24 * 60 * 60 * 1000;
  const scheduled = await client.maintenance.createMaintenance({
    title: "Postgres 16 minor upgrade",
    description: "Rolling upgrade of the primary database with a brief failover.",
    startAt: new Date(Date.now() + 3 * day),
    endAt: new Date(Date.now() + 3 * day + 2 * 60 * 60 * 1000),
    systemIds: [systemId],
  });
  await client.maintenance.createMaintenance({
    title: "Cache node replacement",
    description: "Replaced a Redis node; completed with no customer impact.",
    startAt: new Date(Date.now() - 10 * day),
    endAt: new Date(Date.now() - 10 * day + 60 * 60 * 1000),
    systemIds: [systemId],
  });
  return scheduled.id;
}

async function seedSatellites({
  client,
}: {
  client: CheckstackClient;
}): Promise<void> {
  await client.satellite.createSatellite({
    name: "EU West",
    region: "eu-west-1",
    tags: { provider: "aws" },
  });
  await client.satellite.createSatellite({
    name: "US East",
    region: "us-east-1",
    tags: { provider: "aws" },
  });
}

async function seedAnnouncements({
  client,
}: {
  client: CheckstackClient;
}): Promise<void> {
  await client.announcement.createAnnouncement({
    title: "New: per-environment health rollups",
    message:
      "Health checks now fan out across environments with per-env charts and rollups.",
    severity: "info",
    visibility: "all",
    // Dashboard card only - no global banner strip on every other shot.
    displayMode: "dashboard",
    active: true,
  });
}

async function seedAutomation({
  client,
}: {
  client: CheckstackClient;
}): Promise<void> {
  const { application } = await client.auth.createApplication({
    name: "Automation runner",
    description: "Service account for demo automations",
  });
  await client.auth.updateApplication({ id: application.id, roles: ["admin"] });
  await client.automation.createAutomation({
    name: "Notify on-call when a tier-1 system goes unhealthy",
    description: "Fan out a Slack alert and open an incident on sustained failure.",
    group: "Reliability",
    status: "enabled",
    runAs: application.id,
    definition: {
      name: "Notify on-call when a tier-1 system goes unhealthy",
      triggers: [{ event: "healthcheck.system_health_changed" }],
    },
  });
}

async function seedNotifications({
  client,
}: {
  client: CheckstackClient;
}): Promise<void> {
  // Best-effort: enable a couple of delivery strategies and subscribe the admin
  // so the notification settings surfaces render populated. Strategy ids vary by
  // installed plugins, so we resolve them at runtime and ignore any that reject.
  try {
    const strategies = await client.notification.getDeliveryStrategies();
    const wanted = strategies.filter((s) =>
      /email|slack|discord/i.test(s.qualifiedId),
    );
    for (const strategy of wanted.slice(0, 3)) {
      await client.notification
        .updateDeliveryStrategy({
          strategyId: strategy.qualifiedId,
          enabled: true,
          config: {},
        })
        .catch(() => {});
    }
    const groups = await client.notification.getGroups().catch(() => []);
    for (const group of groups.slice(0, 3)) {
      await client.notification
        .subscribe({ groupId: group.id })
        .catch(() => {});
    }
  } catch {
    // Notification wiring is decorative for screenshots; never fail the seed.
  }
}

async function seedApplications({
  client,
}: {
  client: CheckstackClient;
}): Promise<void> {
  const { application } = await client.auth.createApplication({
    name: "CI pipeline",
    description: "Deploys and syncs monitoring config from CI",
  });
  await client.auth.updateApplication({ id: application.id, roles: ["admin"] });
}

async function seedTeams({
  client,
}: {
  client: CheckstackClient;
}): Promise<void> {
  const teams = [
    { name: "Payments", description: "Owns checkout and payments services" },
    { name: "Platform", description: "Databases, cache, auth, and edge" },
    { name: "Storefront", description: "Customer-facing web and search" },
  ];
  for (const team of teams) {
    await client.auth.createTeam(team).catch(() => {});
  }
}

async function seedGitOps({
  client,
}: {
  client: CheckstackClient;
}): Promise<void> {
  // Seed a GitOps secret so the Secrets tab renders populated. We deliberately
  // do NOT create a Git provider: a provider needs a real reachable repo to show
  // a clean state, and a demo repo yields a sync-error card. The provider/sync
  // surfaces are omitted from the capture set; the kind registry covers GitOps.
  await client.gitops
    .createSecret({
      name: "PROD_DB_PASSWORD",
      value: "demo-value-not-a-real-secret",
      description: "Postgres monitor password referenced by health checks",
    })
    .catch(() => {});
}
