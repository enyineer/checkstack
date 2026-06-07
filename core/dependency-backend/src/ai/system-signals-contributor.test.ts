import { describe, expect, test } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import type { SystemAccessResolver } from "@checkstack/ai-backend";
import { CatalogApi } from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  dependencyAccess,
  DEPENDENCY_SIGNAL_SOURCE_ID,
  type Dependency,
} from "@checkstack/dependency-common";
import { createDependencySystemSignalsContributor } from "./system-signals-contributor";
import { DependencyService } from "../services/dependency-service";
import { WarningEvaluationService } from "../services/warning-evaluation-service";

const noopLogger = createMockLogger();

function makeDependency(overrides: Partial<Dependency>): Dependency {
  return {
    id: "dep-1",
    sourceSystemId: "downstream",
    targetSystemId: "upstream",
    impactType: "critical",
    transitive: false,
    label: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function stubService(deps: Dependency[]): DependencyService {
  return {
    getAllDependencies: async () => deps,
  } as unknown as DependencyService;
}

function stubCatalogClient(
  systems: Array<{ id: string; name: string }>,
): InferClient<typeof CatalogApi> {
  return {
    getSystems: async () => ({ systems }),
  } as unknown as InferClient<typeof CatalogApi>;
}

function stubHealthCheckClient(
  statuses: Record<
    string,
    { status: "healthy" | "degraded" | "unhealthy"; checkStatuses: [] }
  >,
): InferClient<typeof HealthCheckApi> {
  return {
    getBulkSystemHealthStatus: async () => ({ statuses }),
  } as unknown as InferClient<typeof HealthCheckApi>;
}

// The per-source gate is owned/tested by createGatedSystemSignalsContributor.
const allowAll: SystemAccessResolver = {
  accessibleSystemIds: async ({ systemIds }) => systemIds,
};
const denyAll: SystemAccessResolver = { accessibleSystemIds: async () => [] };

function build({
  deps,
  systems,
  health,
  resolver,
}: {
  deps: Dependency[];
  systems: Array<{ id: string; name: string }>;
  health: Record<
    string,
    { status: "healthy" | "degraded" | "unhealthy"; checkStatuses: [] }
  >;
  resolver: SystemAccessResolver;
}) {
  return createDependencySystemSignalsContributor({
    service: stubService(deps),
    warningService: new WarningEvaluationService(),
    catalogClient: stubCatalogClient(systems),
    healthCheckClient: stubHealthCheckClient(health),
    resolver,
    logger: noopLogger,
  });
}

const realUser = (accessRules: string[]): AuthUser => ({
  type: "user",
  id: "u1",
  accessRules,
});
const grant = `dependency.${dependencyAccess.dependency.read.id}`;

describe("dependency system.issues contributor", () => {
  test("exposes the shared source id", () => {
    const contributor = build({
      deps: [],
      systems: [],
      health: {},
      resolver: allowAll,
    });
    expect(contributor.sourceId).toBe(DEPENDENCY_SIGNAL_SOURCE_ID);
  });

  test("derives signals globally when the principal has access", async () => {
    const contributor = build({
      deps: [
        makeDependency({
          id: "dep-down",
          sourceSystemId: "downstream",
          targetSystemId: "up",
          impactType: "critical",
        }),
      ],
      systems: [
        { id: "downstream", name: "Downstream" },
        { id: "up", name: "Up" },
      ],
      health: { up: { status: "unhealthy", checkStatuses: [] } },
      resolver: allowAll,
    });

    const result = await contributor.read({ principal: realUser([grant]) });

    // Only the downstream system has a warning; the healthy upstream is absent.
    expect(Object.keys(result.signals)).toEqual(["downstream"]);
    expect(result.signals["downstream"][0]).toMatchObject({
      source: DEPENDENCY_SIGNAL_SOURCE_ID,
      tone: "error",
      label: "Upstream down",
    });
  });

  test("routes a non-global user through the team gate (no grants -> nothing)", async () => {
    const contributor = build({
      deps: [makeDependency({ sourceSystemId: "downstream", targetSystemId: "up" })],
      systems: [
        { id: "downstream", name: "Downstream" },
        { id: "up", name: "Up" },
      ],
      health: { up: { status: "unhealthy", checkStatuses: [] } },
      resolver: denyAll,
    });

    const result = await contributor.read({
      principal: realUser(["some.other.rule"]),
    });
    expect(result).toEqual({ accessible: false, signals: {} });
  });

  test("access granted but no dependencies: accessible with empty signals", async () => {
    const contributor = build({
      deps: [],
      systems: [],
      health: {},
      resolver: allowAll,
    });

    const result = await contributor.read({ principal: realUser([grant]) });
    expect(result).toEqual({ accessible: true, signals: {} });
  });
});
