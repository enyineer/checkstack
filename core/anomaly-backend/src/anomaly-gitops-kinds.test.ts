import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ReconcileContext } from "@checkstack/gitops-common";
import type { AnomalyService } from "./service";
import {
  buildHealthcheckAnomalyExtension,
  buildSystemAnomalyExtension,
} from "./anomaly-gitops-kinds";

/**
 * Reconcile-time tests for the anomaly-backend GitOps kind extensions.
 *
 * Exercises the `Healthcheck.anomaly` and `System.anomalyExceptions`
 * extensions in isolation against a stub AnomalyService.
 */

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
  const updateAnomalyConfig = mock(async () => ({}));
  const updateAnomalyAssignmentConfig = mock(async () => ({}));
  return {
    updateAnomalyConfig,
    updateAnomalyAssignmentConfig,
    service: {
      updateAnomalyConfig,
      updateAnomalyAssignmentConfig,
    } as unknown as AnomalyService,
  };
};

describe("buildHealthcheckAnomalyExtension", () => {
  let stub: ReturnType<typeof stubService>;
  let extension: ReturnType<typeof buildHealthcheckAnomalyExtension>;

  beforeEach(() => {
    stub = stubService();
    extension = buildHealthcheckAnomalyExtension({
      getService: () => stub.service,
    });
  });

  it("registers under the right kind/namespace", () => {
    expect(extension.kind).toBe("Healthcheck");
    expect(extension.namespace).toBe("anomaly");
  });

  it("calls updateAnomalyConfig with the spec when present", async () => {
    await extension.reconcile({
      entity: {} as never,
      extensionSpec: {
        enabled: false,
        baselineWindow: "14d",
        notify: false,
      },
      entityId: "hc-1",
      context: buildContext(),
    });
    expect(stub.updateAnomalyConfig).toHaveBeenCalledTimes(1);
    expect(stub.updateAnomalyConfig).toHaveBeenCalledWith("hc-1", {
      enabled: false,
      baselineWindow: "14d",
      notify: false,
    });
  });

  it("is a no-op when extensionSpec is undefined", async () => {
    await extension.reconcile({
      entity: {} as never,
      extensionSpec: undefined,
      entityId: "hc-1",
      context: buildContext(),
    });
    expect(stub.updateAnomalyConfig).not.toHaveBeenCalled();
  });
});

describe("buildSystemAnomalyExtension", () => {
  let stub: ReturnType<typeof stubService>;
  let extension: ReturnType<typeof buildSystemAnomalyExtension>;

  beforeEach(() => {
    stub = stubService();
    extension = buildSystemAnomalyExtension({
      getService: () => stub.service,
    });
  });

  it("registers on the System kind under namespace 'anomaly'", () => {
    expect(extension.kind).toBe("System");
    expect(extension.namespace).toBe("anomaly");
  });

  it("resolves each healthcheckRef and writes assignment overrides", async () => {
    const refMap: Record<string, string> = {
      "hc-cpu": "cfg-cpu",
      "hc-mem": "cfg-mem",
    };

    await extension.reconcile({
      entity: {} as never,
      extensionSpec: [
        {
          healthcheckRef: { kind: "Healthcheck", name: "hc-cpu" },
          enabled: false,
          fieldOverrides: {
            "cpu.usage": { sensitivity: 0.5 },
          },
        },
        {
          healthcheckRef: { kind: "Healthcheck", name: "hc-mem" },
          baselineWindow: "30d",
        },
      ],
      entityId: "sys-1",
      context: buildContext({
        resolveEntityRef: async ({ entityName }) => refMap[entityName],
      }),
    });

    expect(stub.updateAnomalyAssignmentConfig).toHaveBeenCalledTimes(2);
    expect(stub.updateAnomalyAssignmentConfig).toHaveBeenNthCalledWith(
      1,
      "sys-1",
      "cfg-cpu",
      {
        enabled: false,
        fieldOverrides: { "cpu.usage": { sensitivity: 0.5 } },
      },
    );
    expect(stub.updateAnomalyAssignmentConfig).toHaveBeenNthCalledWith(
      2,
      "sys-1",
      "cfg-mem",
      { baselineWindow: "30d" },
    );
  });

  it("throws when a healthcheck ref cannot be resolved", async () => {
    await expect(
      extension.reconcile({
        entity: {} as never,
        extensionSpec: [
          {
            healthcheckRef: { kind: "Healthcheck", name: "missing" },
            enabled: false,
          },
        ],
        entityId: "sys-1",
        context: buildContext({
          resolveEntityRef: async () => undefined,
        }),
      }),
    ).rejects.toThrow(/Cannot resolve Healthcheck ref "missing"/);
  });

  it("is a no-op for empty/undefined specs", async () => {
    await extension.reconcile({
      entity: {} as never,
      extensionSpec: [],
      entityId: "sys-1",
      context: buildContext(),
    });
    await extension.reconcile({
      entity: {} as never,
      extensionSpec: undefined,
      entityId: "sys-1",
      context: buildContext(),
    });
    expect(stub.updateAnomalyAssignmentConfig).not.toHaveBeenCalled();
  });
});
