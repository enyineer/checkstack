import { describe, it, expect, mock, beforeEach } from "bun:test";
import { z } from "zod";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";
import type {
  EntityKindDefinition,
  ReconcileContext,
} from "@checkstack/gitops-common";

/**
 * Tests for the catalog-backend's GitOps entity kind registrations.
 *
 * These tests exercise the reconcile/delete logic in isolation by
 * reconstructing the same kind definitions that catalog-backend registers
 * with the entity kind extension point.
 *
 * The generic entityId pattern: reconcile() returns { entityId }, the
 * reconciler engine stores it in provenance, and passes it back as
 * existingEntityId on subsequent reconciles.
 */

// ─── Mock EntityService ────────────────────────────────────────────────────

interface MockSystem {
  id: string;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface MockGroup {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MockEnvironment {
  id: string;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function createMockEntityService() {
  const systems: MockSystem[] = [];
  const groups: MockGroup[] = [];
  const environments: MockEnvironment[] = [];

  return {
    systems,
    groups,
    environments,
    createEnvironment: mock(
      async (data: {
        name: string;
        description?: string;
        metadata?: Record<string, unknown>;
      }) => {
        const environment: MockEnvironment = {
          id: `env-${environments.length + 1}`,
          name: data.name,
          description: data.description,
          metadata: data.metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        environments.push(environment);
        return environment;
      },
    ),
    updateEnvironment: mock(
      async (
        id: string,
        data: Partial<{
          name: string;
          description?: string;
          metadata?: Record<string, unknown>;
        }>,
      ) => {
        const environment = environments.find((e) => e.id === id);
        if (environment) Object.assign(environment, data);
        return environment;
      },
    ),
    deleteEnvironment: mock(async (id: string) => {
      const idx = environments.findIndex((e) => e.id === id);
      if (idx >= 0) environments.splice(idx, 1);
    }),
    addSystemToEnvironment: mock(
      async (_props: { environmentId: string; systemId: string }) => {},
    ),
    removeSystemFromEnvironment: mock(
      async (_props: { environmentId: string; systemId: string }) => {},
    ),
    getEnvironmentsForSystem: mock(async (_systemId: string) => {
      return [] as { environmentId: string; systemId: string }[];
    }),
    createSystem: mock(
      async (data: {
        name: string;
        description?: string;
        metadata?: Record<string, unknown>;
      }) => {
        const system: MockSystem = {
          id: `sys-${systems.length + 1}`,
          name: data.name,
          description: data.description,
          metadata: data.metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        systems.push(system);
        return system;
      },
    ),
    updateSystem: mock(
      async (
        id: string,
        data: Partial<{
          name: string;
          description?: string;
          metadata?: Record<string, unknown>;
        }>,
      ) => {
      const system = systems.find((s) => s.id === id);
      if (system) {
        Object.assign(system, data);
      }
      return system;
    }),
    deleteSystem: mock(async (id: string) => {
      const idx = systems.findIndex((s) => s.id === id);
      if (idx >= 0) systems.splice(idx, 1);
    }),
    createGroup: mock(async (data: { name: string }) => {
      const group: MockGroup = {
        id: `grp-${groups.length + 1}`,
        name: data.name,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      groups.push(group);
      return group;
    }),
    updateGroup: mock(async (id: string, data: Partial<{ name: string }>) => {
      const group = groups.find((g) => g.id === id);
      if (group) {
        Object.assign(group, data);
      }
      return group;
    }),
    deleteGroup: mock(async (id: string) => {
      const idx = groups.findIndex((g) => g.id === id);
      if (idx >= 0) groups.splice(idx, 1);
    }),
    addSystemToGroup: mock(async (props: { groupId: string; systemId: string }) => {}),
    removeSystemFromGroup: mock(async (props: { groupId: string; systemId: string }) => {}),
    getGroupsForSystem: mock(async (systemId: string) => {
      return [] as { groupId: string, systemId: string }[];
    }),
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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Catalog GitOps Kind: System", () => {
  let mockService: ReturnType<typeof createMockEntityService>;

  const systemSpecSchema = z.object({
    fields: z.record(z.string(), z.unknown()).optional(),
  });
  type SystemSpec = z.infer<typeof systemSpecSchema>;

  function buildSystemKind(
    svc: ReturnType<typeof createMockEntityService>,
  ): EntityKindDefinition<SystemSpec> {
    return {
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: systemSpecSchema,
      reconcile: async ({ entity, existingEntityId, context }) => {
        const displayName = entity.metadata.title ?? entity.metadata.name;
        const description = entity.metadata.description;
        const metadata = entity.spec.fields ?? {};

        if (existingEntityId) {
          await svc.updateSystem(existingEntityId, {
            name: displayName,
            description,
            metadata,
          });
          context.logger.info(`Updated system (id: ${existingEntityId})`);
          return { entityId: existingEntityId };
        }

        const system = await svc.createSystem({
          name: displayName,
          description,
          metadata,
        });
        context.logger.info(`Created system (id: ${system.id})`);
        return { entityId: system.id };
      },
      delete: async ({ entityId }) => {
        if (entityId) await svc.deleteSystem(entityId);
      },
    };
  }

  beforeEach(() => {
    mockService = createMockEntityService();
  });

  it("creates a new system and returns entityId", async () => {
    const kind = buildSystemKind(mockService);

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: {
          name: "payment-service",
          title: "Payment Service",
          description: "Handles payments",
        },
        spec: {},
      },
      context: mockContext,
    });

    expect(result.entityId).toBe("sys-1");
    expect(mockService.createSystem).toHaveBeenCalledTimes(1);
    expect(mockService.systems).toHaveLength(1);
    expect(mockService.systems[0].name).toBe("Payment Service");
    expect(mockService.systems[0].description).toBe("Handles payments");
  });

  it("creates a system with free-form custom fields from spec.fields", async () => {
    const kind = buildSystemKind(mockService);

    await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: { name: "payments", title: "Payments" },
        spec: { fields: { baseUrl: "https://pay.example.com", tier: "1" } },
      },
      context: mockContext,
    });

    expect(mockService.systems[0].metadata).toEqual({
      baseUrl: "https://pay.example.com",
      tier: "1",
    });
  });

  it("defaults system metadata to {} when spec.fields is absent", async () => {
    const kind = buildSystemKind(mockService);

    await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: { name: "no-fields" },
        spec: {},
      },
      context: mockContext,
    });

    expect(mockService.systems[0].metadata).toEqual({});
  });

  it("replaces system custom fields on update from spec.fields", async () => {
    const kind = buildSystemKind(mockService);

    mockService.systems.push({
      id: "sys-existing",
      name: "Old",
      metadata: { region: "eu" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: { name: "payments", title: "Payments" },
        spec: { fields: { region: "us" } },
      },
      existingEntityId: "sys-existing",
      context: mockContext,
    });

    expect(mockService.updateSystem).toHaveBeenCalledTimes(1);
    expect(mockService.systems[0].metadata).toEqual({ region: "us" });
  });

  it("uses metadata.description for the catalog description", async () => {
    const kind = buildSystemKind(mockService);

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: {
          name: "api-gateway",
          description: "Gateway description",
        },
        spec: {},
      },
      context: mockContext,
    });

    expect(result.entityId).toBe("sys-1");
    expect(mockService.systems[0].description).toBe("Gateway description");
  });

  it("falls back to metadata.name when title is missing", async () => {
    const kind = buildSystemKind(mockService);

    await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: { name: "my-service" },
        spec: {},
      },
      context: mockContext,
    });

    expect(mockService.systems[0].name).toBe("my-service");
  });

  it("updates an existing system using existingEntityId", async () => {
    const kind = buildSystemKind(mockService);

    // Pre-populate a system
    mockService.systems.push({
      id: "sys-existing",
      name: "Old Name",
      description: "Old description",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: {
          name: "payment-service",
          title: "Payment Service v2",
          description: "Updated description",
        },
        spec: {},
      },
      existingEntityId: "sys-existing",
      context: mockContext,
    });

    expect(result.entityId).toBe("sys-existing");
    expect(mockService.createSystem).not.toHaveBeenCalled();
    expect(mockService.updateSystem).toHaveBeenCalledTimes(1);
    expect(mockService.systems[0].name).toBe("Payment Service v2");
    expect(mockService.systems[0].description).toBe("Updated description");
  });

  it("deletes a system by entityId", async () => {
    const kind = buildSystemKind(mockService);

    mockService.systems.push({
      id: "sys-del",
      name: "To Delete",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await kind.delete!({
      entityName: "old-service",
      entityId: "sys-del",
      context: mockContext,
    });

    expect(mockService.deleteSystem).toHaveBeenCalledWith("sys-del");
    expect(mockService.systems).toHaveLength(0);
  });

  it("skips delete when entityId is missing", async () => {
    const kind = buildSystemKind(mockService);

    await kind.delete!({
      entityName: "unknown-service",
      context: mockContext,
    });

    expect(mockService.deleteSystem).not.toHaveBeenCalled();
  });
});

describe("Catalog GitOps Kind Extension: System -> groups", () => {
  let mockService: ReturnType<typeof createMockEntityService>;

  beforeEach(() => {
    mockService = createMockEntityService();
  });

  it("associates system with groups and removes stale ones", async () => {
    // We mock getGroupsForSystem to return one existing association
    mockService.getGroupsForSystem.mockResolvedValueOnce([
      { groupId: "grp-stale", systemId: "sys-1" }
    ]);

    const mockExtContext: ReconcileContext = {
      ...mockContext,
      resolveEntityRef: mock(async ({ entityName }) => {
        if (entityName === "new-group") return "grp-new";
        return undefined;
      }),
    };

    // Simulate the inline reconcile logic from index.ts
    const reconcileExt = async ({ extensionSpec, entityId, context }: any) => {
      if (!extensionSpec || extensionSpec.length === 0) return;

      const desiredGroupIds = new Set<string>();

      for (const entry of extensionSpec) {
        const groupId = await context.resolveEntityRef({
          kind: entry.kind,
          entityName: entry.name,
        });
        if (groupId) {
          desiredGroupIds.add(groupId);
          await mockService.addSystemToGroup({ groupId, systemId: entityId });
        }
      }

      const currentAssociations = await mockService.getGroupsForSystem(entityId);
      for (const existing of currentAssociations) {
        if (!desiredGroupIds.has(existing.groupId)) {
          await mockService.removeSystemFromGroup({
            groupId: existing.groupId,
            systemId: entityId,
          });
        }
      }
    };

    await reconcileExt({
      entity: { metadata: { name: "my-system" } },
      extensionSpec: [{ kind: "Group", name: "new-group" }],
      entityId: "sys-1",
      context: mockExtContext,
    });

    expect(mockService.addSystemToGroup).toHaveBeenCalledWith({
      groupId: "grp-new",
      systemId: "sys-1",
    });

    expect(mockService.removeSystemFromGroup).toHaveBeenCalledWith({
      groupId: "grp-stale",
      systemId: "sys-1",
    });
  });
});

describe("Catalog GitOps Kind: Group", () => {
  let mockService: ReturnType<typeof createMockEntityService>;

  const groupSpecSchema = z.object({});
  type GroupSpec = z.infer<typeof groupSpecSchema>;

  function buildGroupKind(
    svc: ReturnType<typeof createMockEntityService>,
  ): EntityKindDefinition<GroupSpec> {
    return {
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Group",
      specSchema: groupSpecSchema,
      reconcile: async ({ entity, existingEntityId, context }) => {
        const displayName = entity.metadata.title ?? entity.metadata.name;

        if (existingEntityId) {
          await svc.updateGroup(existingEntityId, { name: displayName });
          context.logger.info(`Updated group (id: ${existingEntityId})`);
          return { entityId: existingEntityId };
        }

        const group = await svc.createGroup({ name: displayName });
        context.logger.info(`Created group (id: ${group.id})`);
        return { entityId: group.id };
      },
      delete: async ({ entityId }) => {
        if (entityId) await svc.deleteGroup(entityId);
      },
    };
  }

  beforeEach(() => {
    mockService = createMockEntityService();
  });

  it("creates a new group and returns entityId", async () => {
    const kind = buildGroupKind(mockService);

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Group",
        metadata: {
          name: "platform-team",
          title: "Platform Team",
        },
        spec: {},
      },
      context: mockContext,
    });

    expect(result.entityId).toBe("grp-1");
    expect(mockService.createGroup).toHaveBeenCalledTimes(1);
    expect(mockService.groups).toHaveLength(1);
    expect(mockService.groups[0].name).toBe("Platform Team");
  });

  it("updates an existing group using existingEntityId", async () => {
    const kind = buildGroupKind(mockService);

    mockService.groups.push({
      id: "grp-existing",
      name: "Old Group",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Group",
        metadata: {
          name: "platform-team",
          title: "Platform Engineering",
        },
        spec: {},
      },
      existingEntityId: "grp-existing",
      context: mockContext,
    });

    expect(result.entityId).toBe("grp-existing");
    expect(mockService.createGroup).not.toHaveBeenCalled();
    expect(mockService.updateGroup).toHaveBeenCalledTimes(1);
    expect(mockService.groups[0].name).toBe("Platform Engineering");
  });

  it("deletes a group by entityId", async () => {
    const kind = buildGroupKind(mockService);

    mockService.groups.push({
      id: "grp-del",
      name: "To Delete",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await kind.delete!({
      entityName: "old-team",
      entityId: "grp-del",
      context: mockContext,
    });

    expect(mockService.deleteGroup).toHaveBeenCalledWith("grp-del");
    expect(mockService.groups).toHaveLength(0);
  });
});

describe("Catalog GitOps Kind: Environment", () => {
  let mockService: ReturnType<typeof createMockEntityService>;

  const environmentSpecSchema = z.object({
    fields: z.record(z.string(), z.unknown()).optional(),
  });
  type EnvironmentSpec = z.infer<typeof environmentSpecSchema>;

  function buildEnvironmentKind(
    svc: ReturnType<typeof createMockEntityService>,
  ): EntityKindDefinition<EnvironmentSpec> {
    return {
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Environment",
      specSchema: environmentSpecSchema,
      reconcile: async ({ entity, existingEntityId, context }) => {
        const displayName = entity.metadata.title ?? entity.metadata.name;
        const description = entity.metadata.description;
        const metadata = entity.spec.fields ?? {};

        if (existingEntityId) {
          await svc.updateEnvironment(existingEntityId, {
            name: displayName,
            description,
            metadata,
          });
          context.logger.info(`Updated environment (id: ${existingEntityId})`);
          return { entityId: existingEntityId };
        }

        const environment = await svc.createEnvironment({
          name: displayName,
          description,
          metadata,
        });
        context.logger.info(`Created environment (id: ${environment.id})`);
        return { entityId: environment.id };
      },
      delete: async ({ entityId }) => {
        if (entityId) await svc.deleteEnvironment(entityId);
      },
    };
  }

  beforeEach(() => {
    mockService = createMockEntityService();
  });

  it("creates a new environment with free-form custom fields", async () => {
    const kind = buildEnvironmentKind(mockService);

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Environment",
        metadata: {
          name: "production",
          title: "Production",
          description: "Live traffic",
        },
        spec: { fields: { baseUrl: "https://prod.example.com", tier: "1" } },
      },
      context: mockContext,
    });

    expect(result.entityId).toBe("env-1");
    expect(mockService.createEnvironment).toHaveBeenCalledTimes(1);
    expect(mockService.environments).toHaveLength(1);
    expect(mockService.environments[0].name).toBe("Production");
    expect(mockService.environments[0].description).toBe("Live traffic");
    expect(mockService.environments[0].metadata).toEqual({
      baseUrl: "https://prod.example.com",
      tier: "1",
    });
  });

  it("defaults metadata to {} when spec.fields is absent", async () => {
    const kind = buildEnvironmentKind(mockService);

    await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Environment",
        metadata: { name: "staging" },
        spec: {},
      },
      context: mockContext,
    });

    expect(mockService.environments[0].name).toBe("staging");
    expect(mockService.environments[0].metadata).toEqual({});
  });

  it("updates an existing environment using existingEntityId", async () => {
    const kind = buildEnvironmentKind(mockService);

    mockService.environments.push({
      id: "env-existing",
      name: "Old",
      metadata: { region: "eu" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Environment",
        metadata: { name: "production", title: "Production v2" },
        spec: { fields: { region: "us" } },
      },
      existingEntityId: "env-existing",
      context: mockContext,
    });

    expect(result.entityId).toBe("env-existing");
    expect(mockService.createEnvironment).not.toHaveBeenCalled();
    expect(mockService.updateEnvironment).toHaveBeenCalledTimes(1);
    expect(mockService.environments[0].name).toBe("Production v2");
    expect(mockService.environments[0].metadata).toEqual({ region: "us" });
  });

  it("deletes an environment by entityId", async () => {
    const kind = buildEnvironmentKind(mockService);

    mockService.environments.push({
      id: "env-del",
      name: "To Delete",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await kind.delete!({
      entityName: "old-env",
      entityId: "env-del",
      context: mockContext,
    });

    expect(mockService.deleteEnvironment).toHaveBeenCalledWith("env-del");
    expect(mockService.environments).toHaveLength(0);
  });

  it("skips delete when entityId is missing", async () => {
    const kind = buildEnvironmentKind(mockService);

    await kind.delete!({
      entityName: "unknown-env",
      context: mockContext,
    });

    expect(mockService.deleteEnvironment).not.toHaveBeenCalled();
  });
});

describe("Catalog GitOps Kind Extension: System -> environments", () => {
  let mockService: ReturnType<typeof createMockEntityService>;

  beforeEach(() => {
    mockService = createMockEntityService();
  });

  it("associates system with environments and removes stale ones", async () => {
    mockService.getEnvironmentsForSystem.mockResolvedValueOnce([
      { environmentId: "env-stale", systemId: "sys-1" },
    ]);

    const mockExtContext: ReconcileContext = {
      ...mockContext,
      resolveEntityRef: mock(async ({ entityName }) => {
        if (entityName === "new-env") return "env-new";
        return undefined;
      }),
    };

    // Simulate the inline reconcile logic from index.ts
    const reconcileExt = async ({
      extensionSpec,
      entityId,
      context,
    }: {
      extensionSpec?: { kind: string; name: string }[];
      entityId: string;
      context: ReconcileContext;
    }) => {
      if (!extensionSpec || extensionSpec.length === 0) return;

      const desiredEnvironmentIds = new Set<string>();

      for (const entry of extensionSpec) {
        const environmentId = await context.resolveEntityRef({
          kind: entry.kind,
          entityName: entry.name,
        });
        if (environmentId) {
          desiredEnvironmentIds.add(environmentId);
          await mockService.addSystemToEnvironment({
            environmentId,
            systemId: entityId,
          });
        }
      }

      const currentAssociations =
        await mockService.getEnvironmentsForSystem(entityId);
      for (const existing of currentAssociations) {
        if (!desiredEnvironmentIds.has(existing.environmentId)) {
          await mockService.removeSystemFromEnvironment({
            environmentId: existing.environmentId,
            systemId: entityId,
          });
        }
      }
    };

    await reconcileExt({
      extensionSpec: [{ kind: "Environment", name: "new-env" }],
      entityId: "sys-1",
      context: mockExtContext,
    });

    expect(mockService.addSystemToEnvironment).toHaveBeenCalledWith({
      environmentId: "env-new",
      systemId: "sys-1",
    });

    expect(mockService.removeSystemFromEnvironment).toHaveBeenCalledWith({
      environmentId: "env-stale",
      systemId: "sys-1",
    });
  });
});
