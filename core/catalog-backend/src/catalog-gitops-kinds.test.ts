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
 * with the entity kind extension point. The actual database operations
 * are validated via a mock EntityService.
 */

// ─── Mock EntityService ────────────────────────────────────────────────────

interface MockSystem {
  id: string;
  name: string;
  description?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface MockGroup {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function createMockEntityService() {
  const systems: MockSystem[] = [];
  const groups: MockGroup[] = [];

  return {
    systems,
    groups,
    findSystemByGitOpsName: mock(async (entityName: string) =>
      systems.find(
        (s) =>
          (s.metadata as Record<string, unknown>)?.gitops_entity_name ===
          entityName,
      ),
    ),
    createSystem: mock(async (data: { name: string; description?: string; metadata?: Record<string, unknown> }) => {
      const system: MockSystem = {
        id: `sys-${systems.length + 1}`,
        name: data.name,
        description: data.description,
        metadata: data.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      systems.push(system);
      return system;
    }),
    updateSystem: mock(async (id: string, data: Partial<{ name: string; description?: string; metadata?: Record<string, unknown> }>) => {
      const system = systems.find((s) => s.id === id);
      if (system) {
        Object.assign(system, data);
      }
      return system;
    }),
    deleteSystemByGitOpsName: mock(async (entityName: string) => {
      const idx = systems.findIndex(
        (s) =>
          (s.metadata as Record<string, unknown>)?.gitops_entity_name ===
          entityName,
      );
      if (idx >= 0) systems.splice(idx, 1);
    }),
    findGroupByGitOpsName: mock(async (entityName: string) =>
      groups.find(
        (g) =>
          (g.metadata as Record<string, unknown>)?.gitops_entity_name ===
          entityName,
      ),
    ),
    createGroup: mock(async (data: { name: string; metadata?: Record<string, unknown> }) => {
      const group: MockGroup = {
        id: `grp-${groups.length + 1}`,
        name: data.name,
        metadata: data.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      groups.push(group);
      return group;
    }),
    updateGroup: mock(async (id: string, data: Partial<{ name: string; metadata?: Record<string, unknown> }>) => {
      const group = groups.find((g) => g.id === id);
      if (group) {
        Object.assign(group, data);
      }
      return group;
    }),
    deleteGroupByGitOpsName: mock(async (entityName: string) => {
      const idx = groups.findIndex(
        (g) =>
          (g.metadata as Record<string, unknown>)?.gitops_entity_name ===
          entityName,
      );
      if (idx >= 0) groups.splice(idx, 1);
    }),
  };
}

// ─── Test Context ──────────────────────────────────────────────────────────

const mockLogger: ReconcileContext["logger"] = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Catalog GitOps Kind: System", () => {
  let mockService: ReturnType<typeof createMockEntityService>;

  // Recreate the reconcile logic matching catalog-backend's registration
  const systemSpecSchema = z.object({});

  type SystemSpec = z.infer<typeof systemSpecSchema>;

  function buildSystemKind(
    svc: ReturnType<typeof createMockEntityService>,
  ): EntityKindDefinition<SystemSpec> {
    return {
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: systemSpecSchema,
      reconcile: async ({ entity, context }) => {
        const entityName = entity.metadata.name;
        const displayName = entity.metadata.title ?? entityName;
        const description = entity.metadata.description;

        const existing = await svc.findSystemByGitOpsName(entityName);
        if (existing) {
          await svc.updateSystem(existing.id, {
            name: displayName,
            description,
            metadata: {
              ...(existing.metadata as Record<string, unknown> | undefined),
              gitops_entity_name: entityName,
            },
          });
          context.logger.info(`Updated system ${entityName}`);
        } else {
          await svc.createSystem({
            name: displayName,
            description,
            metadata: { gitops_entity_name: entityName },
          });
          context.logger.info(`Created system ${entityName}`);
        }
      },
      delete: async ({ entityName }) => {
        await svc.deleteSystemByGitOpsName(entityName);
      },
    };
  }

  beforeEach(() => {
    mockService = createMockEntityService();
  });

  it("creates a new system when none exists", async () => {
    const kind = buildSystemKind(mockService);

    await kind.reconcile({
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
      context: { logger: mockLogger },
    });

    expect(mockService.createSystem).toHaveBeenCalledTimes(1);
    expect(mockService.systems).toHaveLength(1);
    expect(mockService.systems[0].name).toBe("Payment Service");
    expect(mockService.systems[0].description).toBe("Handles payments");
    expect(mockService.systems[0].metadata.gitops_entity_name).toBe(
      "payment-service",
    );
  });

  it("uses metadata.description for the catalog description", async () => {
    const kind = buildSystemKind(mockService);

    await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        metadata: {
          name: "api-gateway",
          description: "Metadata description",
        },
        spec: {},
      },
      context: { logger: mockLogger },
    });

    expect(mockService.systems[0].description).toBe("Metadata description");
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
      context: { logger: mockLogger },
    });

    expect(mockService.systems[0].name).toBe("my-service");
  });

  it("updates an existing system by GitOps name", async () => {
    const kind = buildSystemKind(mockService);

    // Create initial
    mockService.systems.push({
      id: "sys-existing",
      name: "Old Name",
      description: "Old description",
      metadata: { gitops_entity_name: "payment-service" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await kind.reconcile({
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
      context: { logger: mockLogger },
    });

    expect(mockService.createSystem).not.toHaveBeenCalled();
    expect(mockService.updateSystem).toHaveBeenCalledTimes(1);
    expect(mockService.systems[0].name).toBe("Payment Service v2");
    expect(mockService.systems[0].description).toBe("Updated description");
  });

  it("deletes a system by GitOps entity name", async () => {
    const kind = buildSystemKind(mockService);

    mockService.systems.push({
      id: "sys-del",
      name: "To Delete",
      metadata: { gitops_entity_name: "old-service" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await kind.delete!({
      entityName: "old-service",
      context: { logger: mockLogger },
    });

    expect(mockService.deleteSystemByGitOpsName).toHaveBeenCalledWith(
      "old-service",
    );
    expect(mockService.systems).toHaveLength(0);
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
      reconcile: async ({ entity, context }) => {
        const entityName = entity.metadata.name;
        const displayName = entity.metadata.title ?? entityName;

        const existing = await svc.findGroupByGitOpsName(entityName);
        if (existing) {
          await svc.updateGroup(existing.id, {
            name: displayName,
            metadata: {
              ...(existing.metadata as Record<string, unknown> | undefined),
              gitops_entity_name: entityName,
            },
          });
          context.logger.info(`Updated group ${entityName}`);
        } else {
          await svc.createGroup({
            name: displayName,
            metadata: { gitops_entity_name: entityName },
          });
          context.logger.info(`Created group ${entityName}`);
        }
      },
      delete: async ({ entityName }) => {
        await svc.deleteGroupByGitOpsName(entityName);
      },
    };
  }

  beforeEach(() => {
    mockService = createMockEntityService();
  });

  it("creates a new group when none exists", async () => {
    const kind = buildGroupKind(mockService);

    await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Group",
        metadata: {
          name: "platform-team",
          title: "Platform Team",
        },
        spec: {},
      },
      context: { logger: mockLogger },
    });

    expect(mockService.createGroup).toHaveBeenCalledTimes(1);
    expect(mockService.groups).toHaveLength(1);
    expect(mockService.groups[0].name).toBe("Platform Team");
    expect(mockService.groups[0].metadata.gitops_entity_name).toBe(
      "platform-team",
    );
  });

  it("updates an existing group by GitOps name", async () => {
    const kind = buildGroupKind(mockService);

    mockService.groups.push({
      id: "grp-existing",
      name: "Old Group",
      metadata: { gitops_entity_name: "platform-team" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await kind.reconcile({
      entity: {
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Group",
        metadata: {
          name: "platform-team",
          title: "Platform Engineering",
        },
        spec: {},
      },
      context: { logger: mockLogger },
    });

    expect(mockService.createGroup).not.toHaveBeenCalled();
    expect(mockService.updateGroup).toHaveBeenCalledTimes(1);
    expect(mockService.groups[0].name).toBe("Platform Engineering");
  });

  it("deletes a group by GitOps entity name", async () => {
    const kind = buildGroupKind(mockService);

    mockService.groups.push({
      id: "grp-del",
      name: "To Delete",
      metadata: { gitops_entity_name: "old-team" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await kind.delete!({
      entityName: "old-team",
      context: { logger: mockLogger },
    });

    expect(mockService.deleteGroupByGitOpsName).toHaveBeenCalledWith(
      "old-team",
    );
    expect(mockService.groups).toHaveLength(0);
  });
});
