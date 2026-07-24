import { describe, expect, test, mock } from "bun:test";
import { z } from "zod";
import { configString } from "@checkstack/backend-api";
import type {
  HealthCheckRegistry,
  CollectorRegistry,
} from "@checkstack/backend-api";
import type { SatelliteAssignment } from "@checkstack/satellite-common";
import { executeAssignment } from "./execute-assignment";

const logger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
} as never;

const deps = {
  requestRunSecrets: mock(async () => ({})),
  requestConfigSecrets: mock(async () => ({ strategy: {}, collectors: {} })),
};

/** A strategy whose config has a templatable `url`; its client exposes timings. */
function makeRegistries(props?: {
  collectorExecute?: (params: {
    config: unknown;
  }) => Promise<{ result: Record<string, unknown>; error?: string }>;
  timings?: Record<string, number>;
}): {
  healthCheckRegistry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  connectedWith: { value?: unknown };
  collectorConfig: { value?: unknown };
} {
  const connectedWith: { value?: unknown } = {};
  const collectorConfig: { value?: unknown } = {};

  const healthCheckRegistry = {
    getStrategy: mock(() => ({
      id: "http",
      config: {
        schema: z.object({ url: configString({ "x-templatable": true }) }),
      },
      createClient: mock(async (config: unknown) => {
        connectedWith.value = config;
        return {
          client: { kind: "fake" },
          close: () => {},
          ...(props?.timings ? { timings: props.timings } : {}),
        };
      }),
    })),
  } as unknown as HealthCheckRegistry;

  const collectorRegistry = {
    getCollector: mock(() => ({
      collector: {
        id: "probe",
        config: {
          schema: z.object({ path: configString({ "x-templatable": true }) }),
        },
        result: { schema: z.object({}) },
        execute: mock(async (params: { config: unknown }) => {
          collectorConfig.value = params.config;
          if (props?.collectorExecute) return props.collectorExecute(params);
          return { result: { ok: true } };
        }),
      },
    })),
  } as unknown as CollectorRegistry;

  return { healthCheckRegistry, collectorRegistry, connectedWith, collectorConfig };
}

const baseAssignment: SatelliteAssignment = {
  configId: "cfg-1",
  systemId: "sys-1",
  strategyId: "http",
  config: { url: "https://{{ system.metadata.host }}/health" },
  collectors: [
    { id: "c1", collectorId: "probe", config: { path: "/{{ environment.slug }}" } },
  ],
  intervalSeconds: 60,
  systemName: "API",
  systemMetadata: { host: "api.example.com" },
};

const environment = {
  id: "env-prod",
  name: "Production",
  fields: { slug: "prod" },
};

describe("executeAssignment (satellite)", () => {
  test("expands {{ system.metadata.* }} and {{ environment.* }} before probing (the reported bug)", async () => {
    const reg = makeRegistries();

    const result = await executeAssignment(baseAssignment, environment, deps, {
      healthCheckRegistry: reg.healthCheckRegistry,
      collectorRegistry: reg.collectorRegistry,
      logger,
    });

    // System custom field expanded in the STRATEGY config...
    expect(reg.connectedWith.value).toEqual({
      url: "https://api.example.com/health",
    });
    // ...and the environment field expanded in the COLLECTOR config.
    expect(reg.collectorConfig.value).toEqual({ path: "/prod" });
    expect(result.status).toBe("healthy");
    expect(result.environmentId).toBe("env-prod");
  });

  test("reports probe-measured transport timings in the result", async () => {
    const reg = makeRegistries({ timings: { dnsMs: 4, connectMs: 11 } });

    const result = await executeAssignment(baseAssignment, environment, deps, {
      healthCheckRegistry: reg.healthCheckRegistry,
      collectorRegistry: reg.collectorRegistry,
      logger,
    });

    expect(result.result?.metadata).toMatchObject({
      timings: { dnsMs: 4, connectMs: 11 },
    });
  });

  test("annotates a collector error as _collectorError and fails the run", async () => {
    const reg = makeRegistries({
      collectorExecute: async () => ({ result: { code: 1 }, error: "boom" }),
    });

    const result = await executeAssignment(baseAssignment, environment, deps, {
      healthCheckRegistry: reg.healthCheckRegistry,
      collectorRegistry: reg.collectorRegistry,
      logger,
    });

    expect(result.status).toBe("unhealthy");
    const collectors = (
      result.result?.metadata as {
        collectors?: Record<string, Record<string, unknown>>;
      }
    )?.collectors;
    expect(collectors?.c1?._collectorError).toBe("boom");
  });

  test("returns an unhealthy result when the strategy is not loaded", async () => {
    const reg = makeRegistries();
    const emptyRegistry = {
      getStrategy: mock(() => undefined),
    } as unknown as HealthCheckRegistry;

    const result = await executeAssignment(baseAssignment, environment, deps, {
      healthCheckRegistry: emptyRegistry,
      collectorRegistry: reg.collectorRegistry,
      logger,
    });

    expect(result.status).toBe("unhealthy");
    expect(result.result?.message).toContain("not found");
  });
});
