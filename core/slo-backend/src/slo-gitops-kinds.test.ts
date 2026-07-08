import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  CHECKSTACK_API_VERSION,
  type ReconcileContext,
} from "@checkstack/gitops-common";
import type { SloService } from "./service";
import type { SloObjective } from "@checkstack/slo-common";
import { buildSloKind } from "./slo-gitops-kinds";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const buildContext = (
  overrides: Partial<ReconcileContext> = {},
): ReconcileContext =>
  ({
    logger: noopLogger,
    resolveEntityRef: async () => undefined,
    resolveSecretsBySchema: async ({ value }) => ({
      resolved: value,
      warnings: [],
    }),
    ...overrides,
  }) as ReconcileContext;

const stubService = () => {
  const created: SloObjective = {
    id: "slo-1",
    systemId: "sys-1",
    healthCheckConfigurationId: null,
    target: 99.9,
    windowDays: 30,
    dependencyExclusion: "strict",
    excludedDependencyIds: [],
    excludeMaintenanceWindows: false,
    burnRateThresholds: {
      warningPercent: 50,
      criticalPercent: 80,
      fastBurnMultiplier: 5,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const createObjective = mock(async () => created);
  const updateObjective = mock(async () => created);
  const deleteObjective = mock(async () => true);
  return {
    created,
    createObjective,
    updateObjective,
    deleteObjective,
    service: {
      createObjective,
      updateObjective,
      deleteObjective,
    } as unknown as SloService,
  };
};

const refResolver =
  (table: Record<string, string>) =>
  async ({ entityName }: { kind: string; entityName: string }) =>
    table[entityName];

const mkEntity = <TSpec>(name: string, spec: TSpec) => ({
  apiVersion: CHECKSTACK_API_VERSION,
  kind: "SLO",
  metadata: { name },
  spec,
});

describe("buildSloKind", () => {
  let stub: ReturnType<typeof stubService>;
  let kind: ReturnType<typeof buildSloKind>;

  beforeEach(() => {
    stub = stubService();
    kind = buildSloKind({ getService: () => stub.service });
  });

  it("registers under SLO kind", () => {
    expect(kind.kind).toBe("SLO");
  });

  it("creates an objective when no existing entity id is supplied", async () => {
    const result = await kind.reconcile({
      entity: mkEntity("payments-availability", {
        systemRef: { kind: "System", name: "payments-api" },
        target: 99.9,
        windowDays: 30,
      }),
      context: buildContext({
        resolveEntityRef: refResolver({ "payments-api": "sys-1" }),
      }),
    });

    expect(result.entityId).toBe("slo-1");
    expect(stub.createObjective).toHaveBeenCalledTimes(1);
    expect(stub.createObjective).toHaveBeenCalledWith({
      input: {
        systemId: "sys-1",
        healthCheckConfigurationId: undefined,
        target: 99.9,
        windowDays: 30,
        dependencyExclusion: "strict",
        excludedDependencyIds: [],
        excludeMaintenanceWindows: false,
        burnRateThresholds: {
          warningPercent: 50,
          criticalPercent: 80,
          fastBurnMultiplier: 5,
        },
      },
    });
  });

  it("resolves an optional healthcheck ref into healthCheckConfigurationId", async () => {
    await kind.reconcile({
      entity: mkEntity("payments-http-availability", {
        systemRef: { kind: "System", name: "payments-api" },
        healthcheckRef: { kind: "Healthcheck", name: "payments-http" },
        target: 99.95,
        windowDays: 7,
      }),
      context: buildContext({
        resolveEntityRef: refResolver({
          "payments-api": "sys-1",
          "payments-http": "hc-1",
        }),
      }),
    });

    expect(stub.createObjective).toHaveBeenCalledWith({
      input: expect.objectContaining({
        systemId: "sys-1",
        healthCheckConfigurationId: "hc-1",
      }),
    });
  });

  it("resolves excluded dependency refs to system ids", async () => {
    await kind.reconcile({
      entity: mkEntity("core", {
        systemRef: { kind: "System", name: "core" },
        target: 99.9,
        windowDays: 30,
        dependencyExclusion: "self-only",
        excludedDependencyRefs: [
          { kind: "System", name: "third-party-payments" },
          { kind: "System", name: "third-party-email" },
        ],
      }),
      context: buildContext({
        resolveEntityRef: refResolver({
          core: "sys-core",
          "third-party-payments": "sys-pay",
          "third-party-email": "sys-mail",
        }),
      }),
    });

    expect(stub.createObjective).toHaveBeenCalledWith({
      input: expect.objectContaining({
        excludedDependencyIds: ["sys-pay", "sys-mail"],
        dependencyExclusion: "self-only",
      }),
    });
  });

  it("updates an existing objective when existingEntityId is supplied", async () => {
    await kind.reconcile({
      entity: mkEntity("payments", {
        systemRef: { kind: "System", name: "payments-api" },
        target: 99.95,
        windowDays: 30,
      }),
      existingEntityId: "slo-existing",
      context: buildContext({
        resolveEntityRef: refResolver({ "payments-api": "sys-1" }),
      }),
    });

    expect(stub.createObjective).not.toHaveBeenCalled();
    expect(stub.updateObjective).toHaveBeenCalledWith({
      input: expect.objectContaining({
        id: "slo-existing",
        target: 99.95,
        windowDays: 30,
      }),
    });
  });

  it("treats pending-* entityIds as fresh creates", async () => {
    await kind.reconcile({
      entity: mkEntity("payments", {
        systemRef: { kind: "System", name: "payments-api" },
        target: 99.9,
        windowDays: 30,
      }),
      existingEntityId: "pending-abc",
      context: buildContext({
        resolveEntityRef: refResolver({ "payments-api": "sys-1" }),
      }),
    });

    expect(stub.createObjective).toHaveBeenCalledTimes(1);
    expect(stub.updateObjective).not.toHaveBeenCalled();
  });

  it("throws when systemRef cannot be resolved", async () => {
    await expect(
      kind.reconcile({
        entity: mkEntity("broken", {
          systemRef: { kind: "System", name: "nope" },
          target: 99.9,
          windowDays: 30,
        }),
        context: buildContext({ resolveEntityRef: async () => undefined }),
      }),
    ).rejects.toThrow(/Cannot resolve system ref "nope"/);
  });

  it("delegates delete to the service", async () => {
    await kind.delete!({
      entityName: "payments",
      entityId: "slo-1",
      context: buildContext(),
    });
    expect(stub.deleteObjective).toHaveBeenCalledWith({ id: "slo-1" });
  });

  it("delete is a no-op when entityId is missing", async () => {
    await kind.delete!({ entityName: "x", context: buildContext() });
    expect(stub.deleteObjective).not.toHaveBeenCalled();
  });
});
