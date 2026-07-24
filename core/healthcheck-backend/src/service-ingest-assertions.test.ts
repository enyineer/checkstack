import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import {
  computeAssertionKey,
  healthResultNumber,
  healthResultString,
  type CollectorConfigEntry,
} from "@checkstack/healthcheck-common";
import { HealthCheckService } from "./service";

/**
 * Satellite ingest evaluates assertions ON THE CORE (satellites never held
 * the assertion semantics — before this, satellite-executed checks silently
 * skipped assertions), then strips ephemeral fields for parity with local
 * runs. `processSatelliteResult` returns the processed status + result record
 * (and the check name); the shared post-run path persists it. These tests
 * assert on that returned payload.
 */

const KEY = computeAssertionKey({
  assertion: { field: "statusCode", operator: "equals", value: 200 },
});

// `body` is ephemeral: assertable at evaluation time, never persisted.
const collectorResultSchema = z.object({
  statusCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-anomaly-enabled": false,
  }),
  body: healthResultString({ "x-ephemeral": true }),
});

function buildService({ entries }: { entries: CollectorConfigEntry[] }) {
  const db = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() =>
          Promise.resolve([{ name: "Test check", collectors: entries }]),
        ),
      })),
    })),
  };

  const collectorRegistry = {
    register: mock(() => {}),
    getCollector: mock(() => ({
      collector: {
        id: "test-collector",
        result: new Versioned({ version: 1, schema: collectorResultSchema }),
      },
    })),
    getCollectors: mock(() => []),
  };

  return new HealthCheckService(
    db as unknown as ConstructorParameters<typeof HealthCheckService>[0],
    {} as unknown as ConstructorParameters<typeof HealthCheckService>[1],
    collectorRegistry as unknown as ConstructorParameters<
      typeof HealthCheckService
    >[2],
  );
}

function satelliteResult({ statusCode }: { statusCode: number }) {
  return {
    status: "healthy",
    latencyMs: 42,
    message: "Completed in 42ms",
    metadata: {
      collectors: {
        "entry-1": {
          _collectorId: "test-collector",
          statusCode,
          body: '{"status":"ok"}',
        },
      },
    },
  };
}

const entries: CollectorConfigEntry[] = [
  {
    id: "entry-1",
    collectorId: "test-collector",
    config: {},
    assertions: [{ field: "statusCode", operator: "equals", value: 200 }],
  },
];

async function process({
  entries,
  statusCode,
}: {
  entries: CollectorConfigEntry[];
  statusCode: number;
}) {
  const service = buildService({ entries });
  return service.processSatelliteResult({
    configId: "config-1",
    status: "healthy",
    result: satelliteResult({ statusCode }) as never,
  });
}

function collectorEntryOf(resultRecord: Record<string, unknown>) {
  const result = resultRecord as {
    metadata: { collectors: Record<string, Record<string, unknown>> };
  };
  return result.metadata.collectors["entry-1"];
}

describe("processSatelliteResult - assertion evaluation at ingest", () => {
  it("downgrades a satellite-healthy run whose assertion fails", async () => {
    const { status, resultRecord } = await process({ entries, statusCode: 404 });
    expect(status).toBe("unhealthy");

    const entry = collectorEntryOf(resultRecord);
    expect(entry._assertionFailed).toBe("statusCode equals 200");
    expect(entry._assertions).toEqual([
      expect.objectContaining({ key: KEY, passed: false, actual: "404" }),
    ]);
    expect((resultRecord as { message: string }).message).toBe(
      "Check failed: Assertion failed: statusCode equals 200",
    );
  });

  it("keeps a passing run healthy and stores the passing outcome", async () => {
    const { status, resultRecord } = await process({ entries, statusCode: 200 });
    expect(status).toBe("healthy");

    const entry = collectorEntryOf(resultRecord);
    expect(entry._assertionFailed).toBeUndefined();
    expect(entry._assertions).toEqual([
      expect.objectContaining({ key: KEY, passed: true, actual: "200" }),
    ]);
  });

  it("resolves the check name for the notification", async () => {
    const { configName } = await process({ entries, statusCode: 200 });
    expect(configName).toBe("Test check");
  });

  it("strips ephemeral fields AFTER assertions ran against them", async () => {
    const withBodyAssertion: CollectorConfigEntry[] = [
      {
        id: "entry-1",
        collectorId: "test-collector",
        config: {},
        assertions: [
          {
            field: "body.$",
            jsonPath: "$.status",
            operator: "equals",
            value: "ok",
          },
        ],
      },
    ];
    const { status, resultRecord } = await process({
      entries: withBodyAssertion,
      statusCode: 200,
    });

    const entry = collectorEntryOf(resultRecord);
    // The JSONPath assertion evaluated against the (ephemeral) body...
    expect(entry._assertions).toEqual([
      expect.objectContaining({ passed: true, actual: "ok" }),
    ]);
    // ...but the body itself never reaches storage.
    expect(entry.body).toBeUndefined();
    expect(entry.statusCode).toBe(200);
    expect(status).toBe("healthy");
  });

  it("tolerates collector entries the config no longer knows", async () => {
    const { status, resultRecord } = await process({
      entries: [],
      statusCode: 500,
    });
    // No assertions configured: status passes through untouched.
    expect(status).toBe("healthy");
    const entry = collectorEntryOf(resultRecord);
    expect(entry._assertions).toBeUndefined();
  });
});
