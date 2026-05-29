import { describe, it, expect, mock, beforeEach } from "bun:test";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";
import type { ReconcileContext } from "@checkstack/gitops-common";
import {
  buildHealthcheckKind,
  buildSystemHealthcheckExtension,
} from "./healthcheck-gitops-kinds";
import type {
  HealthCheckConfiguration,
  CreateHealthCheckConfiguration,
  UpdateHealthCheckConfiguration,
} from "@checkstack/healthcheck-common";
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";

/**
 * Tests for the healthcheck-backend's GitOps entity kind registrations.
 *
 * Exercises reconcile/delete for kind: Healthcheck and the
 * System → healthchecks extension in isolation with mock services.
 */

// ─── Mock Healthcheck Service ──────────────────────────────────────────────

interface MockConfig {
  id: string;
  name: string;
  strategyId: string;
  config: Record<string, unknown>;
  intervalSeconds: number;
  collectors?: unknown[];
  paused: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface MockAssociation {
  systemId: string;
  configurationId: string;
  enabled: boolean;
  notificationPolicy?: {
    suppressDeEscalations: boolean;
    autoOpenIncidentOnUnhealthy: boolean;
    useNotificationSuppression: boolean;
    incidentThreshold: { transitions: number; windowMinutes: number };
  };
}

function createMockService() {
  const configs: MockConfig[] = [];
  const associations: MockAssociation[] = [];

  return {
    configs,
    associations,
    createConfiguration: mock(async (data: CreateHealthCheckConfiguration) => {
      const config: MockConfig = {
        id: `hc-${configs.length + 1}`,
        name: data.name,
        strategyId: data.strategyId,
        config: data.config,
        intervalSeconds: data.intervalSeconds,
        collectors: data.collectors,
        paused: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      configs.push(config);
      return config as unknown as HealthCheckConfiguration;
    }),
    updateConfiguration: mock(
      async (id: string, data: UpdateHealthCheckConfiguration) => {
        const config = configs.find((c) => c.id === id);
        if (config) {
          Object.assign(config, data, { updatedAt: new Date() });
        }
        return config as unknown as HealthCheckConfiguration | undefined;
      },
    ),
    deleteConfiguration: mock(async (id: string) => {
      const idx = configs.findIndex((c) => c.id === id);
      if (idx >= 0) configs.splice(idx, 1);
    }),
    associateSystem: mock(
      async (props: {
        systemId: string;
        configurationId: string;
        enabled?: boolean;
        notificationPolicy?: MockAssociation["notificationPolicy"];
      }) => {
        const existing = associations.find(
          (a) =>
            a.systemId === props.systemId &&
            a.configurationId === props.configurationId,
        );
        if (existing) {
          existing.enabled = props.enabled ?? true;
          existing.notificationPolicy = props.notificationPolicy;
        } else {
          associations.push({
            systemId: props.systemId,
            configurationId: props.configurationId,
            enabled: props.enabled ?? true,
            notificationPolicy: props.notificationPolicy,
          });
        }
      },
    ),
    disassociateSystem: mock(
      async (systemId: string, configurationId: string) => {
        const idx = associations.findIndex(
          (a) =>
            a.systemId === systemId && a.configurationId === configurationId,
        );
        if (idx >= 0) associations.splice(idx, 1);
      },
    ),
    getSystemConfigurations: mock(async (systemId: string) => {
      return associations
        .filter((a) => a.systemId === systemId)
        .map((a) => {
          const config = configs.find((c) => c.id === a.configurationId);
          return config as unknown as HealthCheckConfiguration;
        })
        .filter(Boolean);
    }),
    getConfiguration: mock(async (id: string) => {
      const config = configs.find((c) => c.id === id);
      return config as unknown as HealthCheckConfiguration | undefined;
    }),
  };
}

// ─── Mock Registries ───────────────────────────────────────────────────────

const postgresConfigSchema = z.object({
  host: z.string(),
  port: z.number().optional(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
});

const cpuCollectorConfigSchema = z.object({
  warningThreshold: z.number().optional(),
});

function createMockHealthCheckRegistry() {
  const strategies = new Map<
    string,
    { strategy: any; ownerPluginId: string; qualifiedId: string }
  >();

  const strategy = {
    id: "postgres",
    displayName: "PostgreSQL",
    description: "test",
    config: new Versioned({
      version: 1,
      schema: postgresConfigSchema,
    }),
  };

  // Register a test strategy
  strategies.set("postgres", {
    strategy,
    ownerPluginId: "mock",
    qualifiedId: "postgres",
  });

  return {
    getStrategy: (id: string) => strategies.get(id)?.strategy as ReturnType<import("@checkstack/backend-api").HealthCheckRegistry["getStrategy"]>,
    getStrategies: () =>
      [...strategies.values()].map(s => s.strategy) as ReturnType<import("@checkstack/backend-api").HealthCheckRegistry["getStrategies"]>,
    getStrategiesWithMeta: () => [...strategies.values()] as any,
    register: () => {},
  };
}

function createMockCollectorRegistry() {
  const collectors = new Map<
    string,
    { qualifiedId: string; collector: { config: Versioned<unknown> } }
  >();

  collectors.set("collector-hardware.cpu", {
    qualifiedId: "collector-hardware.cpu",
    collector: {
      config: new Versioned({
        version: 1,
        schema: cpuCollectorConfigSchema,
      }),
    },
  });

  return {
    getCollector: (id: string) => collectors.get(id) as ReturnType<import("@checkstack/backend-api").CollectorRegistry["getCollector"]>,
    getCollectors: () =>
      [...collectors.values()] as ReturnType<import("@checkstack/backend-api").CollectorRegistry["getCollectors"]>,
    getCollectorsForPlugin: () => [],
    register: () => {},
  };
}

// ─── Test Context ──────────────────────────────────────────────────────────

const mockContext: ReconcileContext = {
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  resolveEntityRef: async () => undefined,
  resolveSecretsBySchema: async <T>(params: { value: T }): Promise<{ resolved: T; warnings: string[] }> =>
    ({ resolved: params.value, warnings: [] }),
};

// ─── Tests: kind: Healthcheck ──────────────────────────────────────────────

describe("Healthcheck GitOps Kind: Healthcheck", () => {
  let mockService: ReturnType<typeof createMockService>;
  let mockHCRegistry: ReturnType<typeof createMockHealthCheckRegistry>;
  let mockCollectorRegistry: ReturnType<typeof createMockCollectorRegistry>;

  beforeEach(() => {
    mockService = createMockService();
    mockHCRegistry = createMockHealthCheckRegistry();
    mockCollectorRegistry = createMockCollectorRegistry();
  });

  function buildKind() {
    const mockDeps = {
      createService: () => mockService as any,
      getHealthCheckRegistry: () => mockHCRegistry as any,
      getCollectorRegistry: () => mockCollectorRegistry as any,
      getQueueManager: () => ({ getQueue: () => ({ scheduleRecurring: async () => "job-123" }) } as any),
    };
    return buildHealthcheckKind(mockDeps);
  }

  it("creates a new healthcheck configuration and returns entityId", async () => {
    const kind = buildKind();

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        metadata: { name: "payment-db-check", title: "Payment DB Health" },
        spec: {
          strategy: "postgres",
          intervalSeconds: 30,
          config: {
            host: "db.internal",
            port: 5432,
            database: "payments",
            user: "monitor",
            password: "secret",
          },
        },
      },
      context: mockContext,
    });

    expect(result.entityId).toBe("hc-1");
    expect(mockService.createConfiguration).toHaveBeenCalledTimes(1);
    expect(mockService.configs).toHaveLength(1);
    expect(mockService.configs[0].name).toBe("Payment DB Health");
    expect(mockService.configs[0].strategyId).toBe("postgres");
  });

  it("creates a new configuration when existingEntityId is a pending error record", async () => {
    const kind = buildKind();

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        metadata: { name: "payment-db-check" },
        spec: {
          strategy: "postgres",
          intervalSeconds: 30,
          config: {
            host: "db.internal",
            port: 5432,
            database: "payments",
            user: "monitor",
            password: "secret",
          },
        },
      },
      existingEntityId: "pending-12345",
      context: mockContext,
    });

    expect(result.entityId).toBe("hc-1");
    expect(mockService.createConfiguration).toHaveBeenCalledTimes(1);
    expect(mockService.updateConfiguration).not.toHaveBeenCalled();
    expect(mockService.configs).toHaveLength(1);
  });

  it("updates an existing configuration using existingEntityId", async () => {
    const kind = buildKind();

    mockService.configs.push({
      id: "hc-existing",
      name: "Old Name",
      strategyId: "postgres",
      config: {},
      intervalSeconds: 60,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        metadata: { name: "payment-db-check", title: "Updated Check" },
        spec: {
          strategy: "postgres",
          intervalSeconds: 15,
          config: {
            host: "db.new",
            port: 5432,
            database: "payments",
            user: "monitor",
            password: "new-secret",
          },
        },
      },
      existingEntityId: "hc-existing",
      context: mockContext,
    });

    expect(result.entityId).toBe("hc-existing");
    expect(mockService.updateConfiguration).toHaveBeenCalledTimes(1);
    expect(mockService.createConfiguration).not.toHaveBeenCalled();
    expect(mockService.configs[0].name).toBe("Updated Check");
  });

  it("deletes a configuration by entityId", async () => {
    const kind = buildKind();

    mockService.configs.push({
      id: "hc-del",
      name: "To Delete",
      strategyId: "postgres",
      config: {},
      intervalSeconds: 30,
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await kind.delete!({
      entityName: "old-check",
      entityId: "hc-del",
      context: mockContext,
    });

    expect(mockService.deleteConfiguration).toHaveBeenCalledWith("hc-del");
    expect(mockService.configs).toHaveLength(0);
  });

  it("skips delete when entityId is missing", async () => {
    const kind = buildKind();

    await kind.delete!({
      entityName: "unknown-check",
      context: mockContext,
    });

    expect(mockService.deleteConfiguration).not.toHaveBeenCalled();
  });

  it("throws on unknown strategy", async () => {
    const kind = buildKind();

    await expect(
      kind.reconcile({
        entity: {
          apiVersion: CHECKSTACK_API_VERSION,
          kind: "Healthcheck",
          metadata: { name: "bad-check" },
          spec: {
            strategy: "nonexistent",
            intervalSeconds: 30,
            config: {},
          },
        },
        context: mockContext,
      }),
    ).rejects.toThrow(/Unknown health check strategy "nonexistent"/);
  });

  it("validates config against strategy schema", async () => {
    const kind = buildKind();

    await expect(
      kind.reconcile({
        entity: {
          apiVersion: CHECKSTACK_API_VERSION,
          kind: "Healthcheck",
          metadata: { name: "bad-config" },
          spec: {
            strategy: "postgres",
            intervalSeconds: 30,
            config: {
              // Missing required fields: host, database, user, password
              port: "not-a-number",
            },
          },
        },
        context: mockContext,
      }),
    ).rejects.toThrow(/config validation failed/);
  });

  it("validates collector configs against collector registry schemas", async () => {
    const kind = buildKind();

    await expect(
      kind.reconcile({
        entity: {
          apiVersion: CHECKSTACK_API_VERSION,
          kind: "Healthcheck",
          metadata: { name: "bad-collector" },
          spec: {
            strategy: "postgres",
            intervalSeconds: 30,
            config: {
              host: "db.local",
              database: "test",
              user: "root",
              password: "pass",
            },
            collectors: [
              {
                collectorId: "unknown-collector",
                config: {},
              },
            ],
          },
        },
        context: mockContext,
      }),
    ).rejects.toThrow(/Unknown collector "unknown-collector"/);
  });

  it("accepts valid collector configs", async () => {
    const kind = buildKind();

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        metadata: { name: "with-collector" },
        spec: {
          strategy: "postgres",
          intervalSeconds: 30,
          config: {
            host: "db.local",
            database: "test",
            user: "root",
            password: "pass",
          },
          collectors: [
            {
              collectorId: "collector-hardware.cpu",
              config: { warningThreshold: 90 },
            },
          ],
        },
      },
      context: mockContext,
    });

    expect(result.entityId).toBe("hc-1");
    expect(mockService.createConfiguration).toHaveBeenCalledTimes(1);
  });
});

// ─── Tests: System → healthchecks extension ────────────────────────────────

describe("Healthcheck GitOps Kind: System Extension", () => {
  let mockService: ReturnType<typeof createMockService>;

  beforeEach(() => {
    mockService = createMockService();
  });

  function buildExtension() {
    return buildSystemHealthcheckExtension({
      createService: () =>
        ({
          associateSystem: mockService.associateSystem,
          disassociateSystem: mockService.disassociateSystem,
          getSystemConfigurations: mockService.getSystemConfigurations,
          getConfiguration: mockService.getConfiguration,
        }) as never,
      getHealthCheckRegistry: () => createMockHealthCheckRegistry() as never,
      getCollectorRegistry: () => createMockCollectorRegistry() as never,
      getQueueManager: () => ({ getQueue: () => ({ scheduleRecurring: async () => "job-123" }) } as any),
    });
  }

  it("creates associations from ref array", async () => {
    const ext = buildExtension();

    // Setup: two healthchecks exist in provenance
    const contextWithRefs: ReconcileContext = {
      ...mockContext,
      resolveEntityRef: async ({ kind, entityName }) => {
        const entries: Record<string, Record<string, string>> = {
          Healthcheck: {
            "db-check": "hc-1",
            "api-check": "hc-2",
          },
        };
        return entries[kind]?.[entityName];
      },
    };

    await ext.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: { name: "payment-service" },
        spec: {},
      },
      extensionSpec: [
        { ref: { kind: "Healthcheck", name: "db-check" }, degradedThreshold: 3, unhealthyThreshold: 5 },
        { ref: { kind: "Healthcheck", name: "api-check" } },
      ],
      entityId: "sys-123",
      context: contextWithRefs,
    });

    expect(mockService.associateSystem).toHaveBeenCalledTimes(2);
    expect(mockService.associations).toHaveLength(2);
    expect(mockService.associations[0].systemId).toBe("sys-123");
    expect(mockService.associations[0].configurationId).toBe("hc-1");
    expect(mockService.associations[1].configurationId).toBe("hc-2");
  });

  it("removes stale associations not in spec", async () => {
    const ext = buildExtension();

    // Pre-populate: system has 2 existing associations, spec only wants 1
    mockService.configs.push(
      {
        id: "hc-keep",
        name: "Keep",
        strategyId: "postgres",
        config: {},
        intervalSeconds: 30,
        paused: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "hc-remove",
        name: "Remove",
        strategyId: "postgres",
        config: {},
        intervalSeconds: 30,
        paused: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );
    mockService.associations.push(
      { systemId: "sys-123", configurationId: "hc-keep", enabled: true },
      { systemId: "sys-123", configurationId: "hc-remove", enabled: true },
    );

    const contextWithRefs: ReconcileContext = {
      ...mockContext,
      resolveEntityRef: async ({ kind, entityName }) => {
        const entries: Record<string, Record<string, string>> = {
          Healthcheck: { "keep-check": "hc-keep" },
        };
        return entries[kind]?.[entityName];
      },
    };

    await ext.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: { name: "my-system" },
        spec: {},
      },
      extensionSpec: [{ ref: { kind: "Healthcheck", name: "keep-check" } }],
      entityId: "sys-123",
      context: contextWithRefs,
    });

    expect(mockService.disassociateSystem).toHaveBeenCalledTimes(1);
    expect(mockService.disassociateSystem).toHaveBeenCalledWith(
      "sys-123",
      "hc-remove",
    );
  });

  it("errors on unresolvable healthcheck ref", async () => {
    const ext = buildExtension();

    const contextEmpty: ReconcileContext = {
      ...mockContext,
      resolveEntityRef: async () => undefined,
    };

    await expect(
      ext.reconcile({
        entity: {
          apiVersion: CHECKSTACK_API_VERSION,
          kind: "System",
          metadata: { name: "my-system" },
          spec: {},
        },
        extensionSpec: [{ ref: { kind: "Healthcheck", name: "nonexistent-check" } }],
        entityId: "sys-123",
        context: contextEmpty,
      }),
    ).rejects.toThrow(/Cannot resolve Healthcheck ref "nonexistent-check"/);
  });

  it("passes a fully-defaulted notificationPolicy through when partial fields are supplied", async () => {
    const ext = buildExtension();

    const contextWithRefs: ReconcileContext = {
      ...mockContext,
      resolveEntityRef: async ({ kind, entityName }) =>
        kind === "Healthcheck" && entityName === "db-check" ? "hc-1" : undefined,
    };

    await ext.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: { name: "payment-service" },
        spec: {},
      },
      extensionSpec: [
        {
          ref: { kind: "Healthcheck", name: "db-check" },
          // Operator only sets the flap threshold; every other policy
          // field should default in via the schema parse.
          notificationPolicy: {
            incidentThreshold: { transitions: 3 },
          },
        },
      ],
      entityId: "sys-123",
      context: contextWithRefs,
    });

    const policy = mockService.associations[0]?.notificationPolicy;
    expect(policy).toBeDefined();
    expect(policy?.suppressDeEscalations).toBe(false);
    expect(policy?.autoOpenIncidentOnUnhealthy).toBe(true);
    expect(policy?.useNotificationSuppression).toBe(true);
    expect(policy?.incidentThreshold).toEqual({
      transitions: 3,
      windowMinutes: 60,
    });
  });

  it("omits notificationPolicy entirely when the spec doesn't set it", async () => {
    const ext = buildExtension();

    const contextWithRefs: ReconcileContext = {
      ...mockContext,
      resolveEntityRef: async ({ kind, entityName }) =>
        kind === "Healthcheck" && entityName === "db-check" ? "hc-1" : undefined,
    };

    await ext.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: { name: "payment-service" },
        spec: {},
      },
      extensionSpec: [{ ref: { kind: "Healthcheck", name: "db-check" } }],
      entityId: "sys-123",
      context: contextWithRefs,
    });

    expect(mockService.associations[0]?.notificationPolicy).toBeUndefined();
  });

  it("skips when extensionSpec is empty", async () => {
    const ext = buildExtension();

    await ext.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: { name: "my-system" },
        spec: {},
      },
      extensionSpec: [],
      entityId: "sys-123",
      context: mockContext,
    });

    expect(mockService.associateSystem).not.toHaveBeenCalled();
  });
});

// ─── Tests: Secret template resolution in healthcheck configs ──────────────

describe("Healthcheck GitOps: Secret template resolution", () => {
  it("collectSecretNames extracts secrets from healthcheck config", async () => {
    const { collectSecretNames } = await import("@checkstack/gitops-common");

    const spec = {
      strategy: "postgres",
      intervalSeconds: 30,
      config: {
        host: "db.internal",
        port: 5432,
        database: "payments",
        user: "monitor",
        password: "${{ secrets.DB_PASS }}",
      },
    };

    const names = collectSecretNames({ value: spec });
    expect(names).toEqual(["DB_PASS"]);
  });

  it("collectSecretNames extracts multiple secrets from config", async () => {
    const { collectSecretNames } = await import("@checkstack/gitops-common");

    const spec = {
      strategy: "postgres",
      intervalSeconds: 30,
      config: {
        host: "db.internal",
        user: "${{ secrets.DB_USER }}",
        password: "${{ secrets.DB_PASS }}",
      },
    };

    const names = collectSecretNames({ value: spec });
    expect(names).toContain("DB_USER");
    expect(names).toContain("DB_PASS");
    expect(names).toHaveLength(2);
  });

  it("collectSecretNames handles inline interpolation in config values", async () => {
    const { collectSecretNames } = await import("@checkstack/gitops-common");

    const spec = {
      strategy: "postgres",
      intervalSeconds: 30,
      config: {
        connectionString:
          "postgres://${{ secrets.DB_USER }}:${{ secrets.DB_PASS }}@host/db",
      },
    };

    const names = collectSecretNames({ value: spec });
    expect(names).toContain("DB_USER");
    expect(names).toContain("DB_PASS");
  });

  it("SECRET_TEMPLATE_REGEX correctly identifies templates in healthcheck config values", async () => {
    const { SECRET_TEMPLATE_REGEX } = await import("@checkstack/gitops-common");

    const configValues = [
      { input: "${{ secrets.DB_PASS }}", expectedSecrets: ["DB_PASS"] },
      { input: "db-${{ secrets.ENV }}.internal", expectedSecrets: ["ENV"] },
      {
        input:
          "postgres://${{ secrets.DB_USER }}:${{ secrets.DB_PASS }}@host/db",
        expectedSecrets: ["DB_USER", "DB_PASS"],
      },
      { input: "plain-value", expectedSecrets: [] },
    ];

    for (const { input, expectedSecrets } of configValues) {
      const found: string[] = [];
      SECRET_TEMPLATE_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SECRET_TEMPLATE_REGEX.exec(input)) !== null) {
        found.push(match[1]);
      }
      expect(found).toEqual(expectedSecrets);
    }
  });

  it("template replacement produces expected resolved config", () => {
    // Simulates what the reconciler does: replace ${{ secrets.X }} with values
    const secrets: Record<string, string> = {
      DB_PASS: "production-password-123",
      ENV: "production",
    };

    const rawConfig: Record<string, string> = {
      host: "db-${{ secrets.ENV }}.internal",
      password: "${{ secrets.DB_PASS }}",
    };

    const resolvedConfig: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawConfig)) {
      resolvedConfig[key] = value.replaceAll(
        /\$\{\{\s*secrets\.([a-zA-Z0-9_-]+)\s*\}\}/g,
        (_match, secretName: string) => secrets[secretName] ?? _match,
      );
    }

    expect(resolvedConfig.host).toBe("db-production.internal");
    expect(resolvedConfig.password).toBe("production-password-123");
  });
});
