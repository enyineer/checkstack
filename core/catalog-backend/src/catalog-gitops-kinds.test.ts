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
  createdAt: Date;
  updatedAt: Date;
}

interface MockGroup {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

function createMockEntityService() {
  const systems: MockSystem[] = [];
  const groups: MockGroup[] = [];

  return {
    systems,
    groups,
    createSystem: mock(async (data: { name: string; description?: string }) => {
      const system: MockSystem = {
        id: `sys-${systems.length + 1}`,
        name: data.name,
        description: data.description,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      systems.push(system);
      return system;
    }),
    updateSystem: mock(async (id: string, data: Partial<{ name: string; description?: string }>) => {
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

  const systemSpecSchema = z.object({});
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

        if (existingEntityId) {
          await svc.updateSystem(existingEntityId, {
            name: displayName,
            description,
          });
          context.logger.info(`Updated system (id: ${existingEntityId})`);
          return { entityId: existingEntityId };
        }

        const system = await svc.createSystem({
          name: displayName,
          description,
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
