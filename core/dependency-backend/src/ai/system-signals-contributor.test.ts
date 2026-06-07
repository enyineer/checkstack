import { describe, expect, test } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
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

/**
 * Build a DependencyService stub whose only used method is getAllDependencies.
 * Cast is unavoidable: the real service requires a live SafeDatabase, which a
 * focused unit test should not stand up.
 */
function stubService(deps: Dependency[]): DependencyService {
  return {
    getAllDependencies: async () => deps,
  } as unknown as DependencyService;
}

/**
 * Build a catalog client stub exposing only getSystems. Cast is unavoidable:
 * InferClient<typeof CatalogApi> is the full generated client surface.
 */
function stubCatalogClient(
  systems: Array<{ id: string; name: string }>,
): InferClient<typeof CatalogApi> {
  return {
    getSystems: async () => ({ systems }),
  } as unknown as InferClient<typeof CatalogApi>;
}

/**
 * Build a healthcheck client stub exposing only getBulkSystemHealthStatus. Cast
 * is unavoidable for the same reason as the catalog stub above.
 */
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

const realUser = (accessRules: string[]): AuthUser => ({
  type: "user",
  id: "u1",
  accessRules,
});

describe("dependency system.issues contributor", () => {
  test("exposes the shared source id", () => {
    const contributor = createDependencySystemSignalsContributor({
      service: stubService([]),
      warningService: new WarningEvaluationService(),
      catalogClient: stubCatalogClient([]),
      healthCheckClient: stubHealthCheckClient({}),
      logger: noopLogger,
    });
    expect(contributor.sourceId).toBe(DEPENDENCY_SIGNAL_SOURCE_ID);
  });

  test("returns {} when the principal lacks dependency.read access", async () => {
    const contributor = createDependencySystemSignalsContributor({
      service: stubService([
        makeDependency({ sourceSystemId: "downstream", targetSystemId: "up" }),
      ]),
      warningService: new WarningEvaluationService(),
      catalogClient: stubCatalogClient([
        { id: "downstream", name: "Downstream" },
        { id: "up", name: "Up" },
      ]),
      healthCheckClient: stubHealthCheckClient({
        up: { status: "unhealthy", checkStatuses: [] },
      }),
      logger: noopLogger,
    });

    const result = await contributor.read({
      principal: realUser(["some.other.rule"]),
    });
    expect(result).toEqual({});
  });

  test("returns derived signals globally when the principal has access", async () => {
    const contributor = createDependencySystemSignalsContributor({
      service: stubService([
        makeDependency({
          id: "dep-down",
          sourceSystemId: "downstream",
          targetSystemId: "up",
          impactType: "critical",
        }),
      ]),
      warningService: new WarningEvaluationService(),
      catalogClient: stubCatalogClient([
        { id: "downstream", name: "Downstream" },
        { id: "up", name: "Up" },
      ]),
      healthCheckClient: stubHealthCheckClient({
        up: { status: "unhealthy", checkStatuses: [] },
      }),
      logger: noopLogger,
    });

    const result = await contributor.read({
      principal: realUser([
        // Fully-qualified grant for the source's read rule.
        `dependency.${dependencyAccess.dependency.read.id}`,
      ]),
    });

    // Only the downstream system has a warning; the healthy upstream is absent.
    expect(Object.keys(result)).toEqual(["downstream"]);
    expect(result["downstream"][0]).toMatchObject({
      source: DEPENDENCY_SIGNAL_SOURCE_ID,
      tone: "error",
      label: "Upstream down",
    });
  });

  test("trusts service users (backend-to-backend) with wildcard access", async () => {
    const contributor = createDependencySystemSignalsContributor({
      service: stubService([
        makeDependency({
          sourceSystemId: "downstream",
          targetSystemId: "up",
          impactType: "degraded",
        }),
      ]),
      warningService: new WarningEvaluationService(),
      catalogClient: stubCatalogClient([
        { id: "downstream", name: "Downstream" },
        { id: "up", name: "Up" },
      ]),
      healthCheckClient: stubHealthCheckClient({
        up: { status: "degraded", checkStatuses: [] },
      }),
      logger: noopLogger,
    });

    const result = await contributor.read({
      principal: { type: "service", pluginId: "some-plugin" },
    });
    expect(Object.keys(result)).toEqual(["downstream"]);
    expect(result["downstream"][0].tone).toBe("warn");
  });

  test("returns {} when there are no dependencies at all", async () => {
    const contributor = createDependencySystemSignalsContributor({
      service: stubService([]),
      warningService: new WarningEvaluationService(),
      catalogClient: stubCatalogClient([]),
      healthCheckClient: stubHealthCheckClient({}),
      logger: noopLogger,
    });

    const result = await contributor.read({
      principal: realUser([`dependency.${dependencyAccess.dependency.read.id}`]),
    });
    expect(result).toEqual({});
  });
});
