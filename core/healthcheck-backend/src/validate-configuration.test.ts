import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import type {
  HealthCheckRegistry,
  CollectorRegistry,
  RegisteredStrategy,
  RegisteredCollector,
} from "@checkstack/backend-api";
import { collectConfigurationIssues } from "./validate-configuration";

/**
 * Build a minimal `Versioned` config wrapper from a single zod schema. The
 * real registry wraps strategy/collector configs in a versioning chain; for
 * validation we only exercise `parseStrictAssumingV1`, which for a v1-only
 * chain is a strict parse of the supplied schema.
 */
function versionedFrom<T>(schema: z.ZodType<T>): Versioned<T> {
  return new Versioned<T>({ version: 1, schema });
}

// A strategy config with a required, typed `url` field. The lightweight
// "required-field present" check only looks at key presence, so a wrong TYPE
// (number instead of string) or an unknown key slips past it — but the strict
// migrate-then-validate path rejects both.
const strategyConfigSchema = z.object({
  url: z.string().url(),
  timeout: z.number().int().min(1).default(5000),
});

const collectorConfigSchema = z.object({
  path: z.string().min(1),
});

function makeRegistries(): {
  registry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
} {
  const strategy = {
    id: "http",
    displayName: "HTTP",
    config: versionedFrom(strategyConfigSchema),
    aggregatedResult: {} as RegisteredStrategy["strategy"]["aggregatedResult"],
    createClient: async () => {
      throw new Error("not used");
    },
    mergeResult: () => ({}),
  } as unknown as RegisteredStrategy["strategy"];

  const registeredStrategy: RegisteredStrategy = {
    strategy,
    ownerPluginId: "healthcheck-http",
    qualifiedId: "healthcheck-http.http",
  };

  const collector = {
    displayName: "File",
    description: "reads a file",
    config: versionedFrom(collectorConfigSchema),
    result: { schema: z.object({}) },
    supportedPlugins: [{ pluginId: "healthcheck-http" }],
  } as unknown as RegisteredCollector["collector"];

  const registeredCollector: RegisteredCollector = {
    qualifiedId: "collector-file.file",
    collector,
    ownerPlugin: { pluginId: "collector-file" },
  };

  const registry: HealthCheckRegistry = {
    register: () => {},
    getStrategy: (id) =>
      id === registeredStrategy.qualifiedId ? strategy : undefined,
    getStrategies: () => [strategy],
    getStrategiesWithMeta: () => [registeredStrategy],
  };

  const collectorRegistry: CollectorRegistry = {
    register: () => {},
    getCollector: (id) =>
      id === registeredCollector.qualifiedId ? registeredCollector : undefined,
    getCollectorsForPlugin: () => [registeredCollector],
    getCollectors: () => [registeredCollector],
  };

  return { registry, collectorRegistry };
}

describe("collectConfigurationIssues", () => {
  it("returns no issues for a fully valid configuration", async () => {
    const { registry, collectorRegistry } = makeRegistries();
    const issues = await collectConfigurationIssues({
      input: {
        name: "valid",
        strategyId: "healthcheck-http.http",
        config: { url: "https://example.test" },
        intervalSeconds: 60,
        collectors: [
          {
            id: "c1",
            collectorId: "collector-file.file",
            config: { path: "/tmp/x" },
          },
        ],
      },
      registry,
      collectorRegistry,
    });
    expect(issues).toEqual([]);
  });

  it("rejects an unknown strategy id", async () => {
    const { registry, collectorRegistry } = makeRegistries();
    const issues = await collectConfigurationIssues({
      input: {
        name: "x",
        strategyId: "healthcheck-http.nope",
        config: { url: "https://example.test" },
        intervalSeconds: 60,
      },
      registry,
      collectorRegistry,
    });
    expect(issues.length).toBe(1);
    expect(issues[0].path).toEqual(["strategyId"]);
    expect(issues[0].message).toContain("Unknown");
  });

  it("rejects an unknown collector id", async () => {
    const { registry, collectorRegistry } = makeRegistries();
    const issues = await collectConfigurationIssues({
      input: {
        name: "x",
        strategyId: "healthcheck-http.http",
        config: { url: "https://example.test" },
        intervalSeconds: 60,
        collectors: [
          { id: "c1", collectorId: "collector-file.ghost", config: {} },
        ],
      },
      registry,
      collectorRegistry,
    });
    expect(issues.length).toBe(1);
    expect(issues[0].path).toEqual(["collectors", 0, "collectorId"]);
  });

  // The key deep-vs-lightweight test: `url` IS present (so the old
  // required-field check passes) but holds the wrong TYPE. Only the strict
  // migrate-then-validate path catches it.
  it("rejects a deep field/type error the presence check would miss", async () => {
    const { registry, collectorRegistry } = makeRegistries();
    const issues = await collectConfigurationIssues({
      input: {
        name: "x",
        strategyId: "healthcheck-http.http",
        // `url` present but a number, not a URL string.
        config: { url: 12345 },
        intervalSeconds: 60,
      },
      registry,
      collectorRegistry,
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].path[0]).toBe("config");
  });

  // Strict parse also rejects unknown/typo'd keys, which a presence check
  // (only asserting required keys EXIST) cannot.
  it("rejects an unknown/typo'd strategy config key", async () => {
    const { registry, collectorRegistry } = makeRegistries();
    const issues = await collectConfigurationIssues({
      input: {
        name: "x",
        strategyId: "healthcheck-http.http",
        config: { url: "https://example.test", tiemout: 5 },
        intervalSeconds: 60,
      },
      registry,
      collectorRegistry,
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].path[0]).toBe("config");
  });

  it("rejects a deep collector config error", async () => {
    const { registry, collectorRegistry } = makeRegistries();
    const issues = await collectConfigurationIssues({
      input: {
        name: "x",
        strategyId: "healthcheck-http.http",
        config: { url: "https://example.test" },
        intervalSeconds: 60,
        collectors: [
          // `path` present but empty string -> violates min(1).
          { id: "c1", collectorId: "collector-file.file", config: { path: "" } },
        ],
      },
      registry,
      collectorRegistry,
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].path.slice(0, 2)).toEqual(["collectors", 0]);
  });
});
