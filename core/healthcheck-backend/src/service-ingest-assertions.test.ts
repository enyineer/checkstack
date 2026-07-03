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
 * runs. These tests drive `ingestSatelliteResult` against a mock db and
 * assert on the run row it persists.
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

function buildService({
  entries,
  inserted,
}: {
  entries: CollectorConfigEntry[];
  inserted: Record<string, unknown>[];
}) {
  const tx = {
    insert: mock(() => ({
      values: mock((vals: Record<string, unknown>) => {
        inserted.push(vals);
        return Object.assign(Promise.resolve(), {
          onConflictDoUpdate: mock(() => Promise.resolve()),
          onConflictDoNothing: mock(() => Promise.resolve()),
        });
      }),
    })),
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() =>
          Object.assign(Promise.resolve([]), {
            limit: mock(() => Promise.resolve([])),
          }),
        ),
      })),
    })),
  };

  const db = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve([{ collectors: entries }])),
      })),
    })),
    transaction: mock(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
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

async function ingest({
  entries,
  statusCode,
}: {
  entries: CollectorConfigEntry[];
  statusCode: number;
}) {
  const inserted: Record<string, unknown>[] = [];
  const service = buildService({ entries, inserted });
  await service.ingestSatelliteResult({
    configId: "config-1",
    systemId: "system-1",
    status: "healthy",
    latencyMs: 42,
    result: satelliteResult({ statusCode }) as never,
    executedAt: "2026-07-03T10:00:00.000Z",
    sourceId: "sat-1",
    sourceLabel: "EU West",
  });
  const runInsert = inserted.find((v) => "status" in v && "result" in v);
  expect(runInsert).toBeDefined();
  return runInsert as Record<string, unknown>;
}

function collectorEntryOf(runInsert: Record<string, unknown>) {
  const result = runInsert.result as {
    metadata: { collectors: Record<string, Record<string, unknown>> };
  };
  return result.metadata.collectors["entry-1"];
}

describe("ingestSatelliteResult - assertion evaluation at ingest", () => {
  it("downgrades a satellite-healthy run whose assertion fails", async () => {
    const runInsert = await ingest({ entries, statusCode: 404 });
    expect(runInsert.status).toBe("unhealthy");

    const entry = collectorEntryOf(runInsert);
    expect(entry._assertionFailed).toBe("statusCode equals 200");
    expect(entry._assertions).toEqual([
      expect.objectContaining({ key: KEY, passed: false, actual: "404" }),
    ]);
    const message = (runInsert.result as { message: string }).message;
    expect(message).toBe(
      "Check failed: Assertion failed: statusCode equals 200",
    );
  });

  it("keeps a passing run healthy and stores the passing outcome", async () => {
    const runInsert = await ingest({ entries, statusCode: 200 });
    expect(runInsert.status).toBe("healthy");

    const entry = collectorEntryOf(runInsert);
    expect(entry._assertionFailed).toBeUndefined();
    expect(entry._assertions).toEqual([
      expect.objectContaining({ key: KEY, passed: true, actual: "200" }),
    ]);
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
    const runInsert = await ingest({
      entries: withBodyAssertion,
      statusCode: 200,
    });

    const entry = collectorEntryOf(runInsert);
    // The JSONPath assertion evaluated against the (ephemeral) body...
    expect(entry._assertions).toEqual([
      expect.objectContaining({ passed: true, actual: "ok" }),
    ]);
    // ...but the body itself never reaches storage.
    expect(entry.body).toBeUndefined();
    expect(entry.statusCode).toBe(200);
    expect(runInsert.status).toBe("healthy");
  });

  it("tolerates collector entries the config no longer knows", async () => {
    const runInsert = await ingest({ entries: [], statusCode: 500 });
    // No assertions configured: status passes through untouched.
    expect(runInsert.status).toBe("healthy");
    const entry = collectorEntryOf(runInsert);
    expect(entry._assertions).toBeUndefined();
  });
});
