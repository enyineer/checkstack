import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ReconcileContext } from "@checkstack/gitops-common";
import type { Dependency } from "@checkstack/dependency-common";
import type { DependencyService } from "./services/dependency-service";
import { buildSystemDependenciesExtension } from "./dependency-gitops-kinds";

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

const refResolver =
  (table: Record<string, string>) =>
  async ({ entityName }: { kind: string; entityName: string }) =>
    table[entityName];

const dep = (
  id: string,
  sourceSystemId: string,
  targetSystemId: string,
  overrides: Partial<Dependency> = {},
): Dependency => ({
  id,
  sourceSystemId,
  targetSystemId,
  impactType: "degraded",
  transitive: false,
  label: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const stubService = (existing: Dependency[] = []) => {
  let store = [...existing];
  const getDependencies = mock(
    async ({
      systemId,
      direction,
    }: {
      systemId: string;
      direction?: "upstream" | "downstream" | "both";
    }) => {
      if (direction === "upstream") {
        return store.filter((d) => d.sourceSystemId === systemId);
      }
      if (direction === "downstream") {
        return store.filter((d) => d.targetSystemId === systemId);
      }
      return store.filter(
        (d) => d.sourceSystemId === systemId || d.targetSystemId === systemId,
      );
    },
  );
  const createDependency = mock(
    async (input: {
      sourceSystemId: string;
      targetSystemId: string;
      impactType: "informational" | "degraded" | "critical";
      transitive?: boolean;
      label?: string;
    }) => {
      const created = dep(
        `dep-${store.length + 1}`,
        input.sourceSystemId,
        input.targetSystemId,
        {
          impactType: input.impactType,
          transitive: input.transitive ?? false,
          label: input.label ?? null,
        },
      );
      store.push(created);
      return created;
    },
  );
  const updateDependency = mock(
    async (input: {
      id: string;
      systemId: string;
      impactType?: "informational" | "degraded" | "critical";
      transitive?: boolean;
      label?: string | null;
    }) => {
      store = store.map((d) =>
        d.id === input.id
          ? {
              ...d,
              impactType: input.impactType ?? d.impactType,
              transitive: input.transitive ?? d.transitive,
              label: input.label === undefined ? d.label : input.label,
            }
          : d,
      );
      return store.find((d) => d.id === input.id);
    },
  );
  const deleteDependency = mock(async (id: string) => {
    const before = store.length;
    store = store.filter((d) => d.id !== id);
    return store.length < before;
  });
  return {
    getDependencies,
    createDependency,
    updateDependency,
    deleteDependency,
    service: {
      getDependencies,
      createDependency,
      updateDependency,
      deleteDependency,
    } as unknown as DependencyService,
    get current() {
      return store;
    },
  };
};

describe("buildSystemDependenciesExtension", () => {
  let stub: ReturnType<typeof stubService>;
  let extension: ReturnType<typeof buildSystemDependenciesExtension>;

  beforeEach(() => {
    stub = stubService();
    extension = buildSystemDependenciesExtension({
      getService: () => stub.service,
    });
  });

  it("registers under System kind, namespace 'dependencies'", () => {
    expect(extension.kind).toBe("System");
    expect(extension.namespace).toBe("dependencies");
  });

  it("creates declared dependencies on first sync", async () => {
    await extension.reconcile({
      entity: {} as never,
      entityId: "sys-payments",
      extensionSpec: [
        {
          targetRef: { kind: "System", name: "db" },
          impactType: "critical",
          transitive: false,
        },
        {
          targetRef: { kind: "System", name: "cache" },
          impactType: "degraded",
          transitive: true,
          label: "fast path",
        },
      ],
      context: buildContext({
        resolveEntityRef: refResolver({ db: "sys-db", cache: "sys-cache" }),
      }),
    });

    expect(stub.createDependency).toHaveBeenCalledTimes(2);
    expect(stub.createDependency).toHaveBeenNthCalledWith(1, {
      sourceSystemId: "sys-payments",
      targetSystemId: "sys-db",
      impactType: "critical",
      transitive: false,
      label: undefined,
      healthCheckRules: [],
    });
    expect(stub.createDependency).toHaveBeenNthCalledWith(2, {
      sourceSystemId: "sys-payments",
      targetSystemId: "sys-cache",
      impactType: "degraded",
      transitive: true,
      label: "fast path",
      healthCheckRules: [],
    });
  });

  it("removes dependencies that are no longer declared", async () => {
    stub = stubService([
      dep("d1", "sys-payments", "sys-db"),
      dep("d2", "sys-payments", "sys-cache"),
    ]);
    extension = buildSystemDependenciesExtension({
      getService: () => stub.service,
    });

    await extension.reconcile({
      entity: {} as never,
      entityId: "sys-payments",
      extensionSpec: [
        {
          targetRef: { kind: "System", name: "db" },
          impactType: "degraded",
          transitive: false,
        },
      ],
      context: buildContext({
        resolveEntityRef: refResolver({ db: "sys-db" }),
      }),
    });

    expect(stub.deleteDependency).toHaveBeenCalledTimes(1);
    expect(stub.deleteDependency).toHaveBeenCalledWith("d2");
    expect(stub.createDependency).not.toHaveBeenCalled();
  });

  it("updates an existing edge when impactType, transitive, or label changes", async () => {
    stub = stubService([
      dep("d1", "sys-payments", "sys-db", {
        impactType: "degraded",
        transitive: false,
        label: null,
      }),
    ]);
    extension = buildSystemDependenciesExtension({
      getService: () => stub.service,
    });

    await extension.reconcile({
      entity: {} as never,
      entityId: "sys-payments",
      extensionSpec: [
        {
          targetRef: { kind: "System", name: "db" },
          impactType: "critical",
          transitive: true,
          label: "primary",
        },
      ],
      context: buildContext({
        resolveEntityRef: refResolver({ db: "sys-db" }),
      }),
    });

    expect(stub.updateDependency).toHaveBeenCalledWith({
      id: "d1",
      systemId: "sys-payments",
      impactType: "critical",
      transitive: true,
      label: "primary",
    });
  });

  it("is a no-op when an edge already matches the spec", async () => {
    stub = stubService([
      dep("d1", "sys-payments", "sys-db", {
        impactType: "critical",
        transitive: false,
        label: null,
      }),
    ]);
    extension = buildSystemDependenciesExtension({
      getService: () => stub.service,
    });

    await extension.reconcile({
      entity: {} as never,
      entityId: "sys-payments",
      extensionSpec: [
        {
          targetRef: { kind: "System", name: "db" },
          impactType: "critical",
          transitive: false,
        },
      ],
      context: buildContext({
        resolveEntityRef: refResolver({ db: "sys-db" }),
      }),
    });

    expect(stub.updateDependency).not.toHaveBeenCalled();
    expect(stub.createDependency).not.toHaveBeenCalled();
    expect(stub.deleteDependency).not.toHaveBeenCalled();
  });

  it("treats an empty/undefined spec as 'remove all my upstream deps'", async () => {
    stub = stubService([
      dep("d1", "sys-payments", "sys-db"),
      dep("d2", "sys-other", "sys-payments"), // downstream — must NOT be touched
    ]);
    extension = buildSystemDependenciesExtension({
      getService: () => stub.service,
    });

    await extension.reconcile({
      entity: {} as never,
      entityId: "sys-payments",
      extensionSpec: [],
      context: buildContext(),
    });

    expect(stub.deleteDependency).toHaveBeenCalledTimes(1);
    expect(stub.deleteDependency).toHaveBeenCalledWith("d1");
  });

  it("rejects refs that resolve to the source system itself", async () => {
    await expect(
      extension.reconcile({
        entity: {} as never,
        entityId: "sys-payments",
        extensionSpec: [
          {
            targetRef: { kind: "System", name: "self" },
            impactType: "degraded",
            transitive: false,
          },
        ],
        context: buildContext({
          resolveEntityRef: refResolver({ self: "sys-payments" }),
        }),
      }),
    ).rejects.toThrow(/cannot depend on itself/);
  });

  it("aborts the diff when a ref cannot be resolved (no mutations)", async () => {
    stub = stubService([dep("d1", "sys-payments", "sys-db")]);
    extension = buildSystemDependenciesExtension({
      getService: () => stub.service,
    });

    await expect(
      extension.reconcile({
        entity: {} as never,
        entityId: "sys-payments",
        extensionSpec: [
          {
            targetRef: { kind: "System", name: "missing" },
            impactType: "degraded",
            transitive: false,
          },
        ],
        context: buildContext({
          resolveEntityRef: async () => undefined,
        }),
      }),
    ).rejects.toThrow(/Cannot resolve System ref "missing"/);

    expect(stub.deleteDependency).not.toHaveBeenCalled();
    expect(stub.createDependency).not.toHaveBeenCalled();
    expect(stub.updateDependency).not.toHaveBeenCalled();
  });
});
