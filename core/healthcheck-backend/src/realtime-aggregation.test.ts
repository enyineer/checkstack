import { describe, it, expect, mock, beforeEach } from "bun:test";
import { getHourBucketStart, incrementHourlyAggregate } from "./realtime-aggregation";
import {
  serializeTDigest,
  deserializeTDigest,
  createTDigest,
} from "@checkstack/backend-api";
import { computeAssertionKey } from "@checkstack/healthcheck-common";

describe("getHourBucketStart", () => {
  it("floors timestamp to the hour", () => {
    const input = new Date("2024-01-15T10:35:42.123Z");
    const result = getHourBucketStart(input);
    expect(result.getTime()).toBe(
      new Date("2024-01-15T10:00:00.000Z").getTime(),
    );
  });

  it("returns same time if already at hour boundary", () => {
    const input = new Date("2024-01-15T10:00:00.000Z");
    const result = getHourBucketStart(input);
    expect(result.getTime()).toBe(input.getTime());
  });

  it("handles midnight correctly", () => {
    const input = new Date("2024-01-15T00:30:00.000Z");
    const result = getHourBucketStart(input);
    expect(result.getTime()).toBe(
      new Date("2024-01-15T00:00:00.000Z").getTime(),
    );
  });

  it("handles end of day correctly", () => {
    const input = new Date("2024-01-15T23:59:59.999Z");
    const result = getHourBucketStart(input);
    expect(result.getTime()).toBe(
      new Date("2024-01-15T23:00:00.000Z").getTime(),
    );
  });
});

describe("t-digest serialization", () => {
  it("serializes and deserializes empty t-digest", () => {
    const original = createTDigest();
    const serialized = serializeTDigest(original);
    const restored = deserializeTDigest(serialized);

    // Empty digest returns empty array
    expect(serialized.length).toBe(0);
    expect(restored.size()).toBe(0);
  });

  it("serializes and deserializes t-digest with values", () => {
    const original = createTDigest();
    original.push(100);
    original.push(200);
    original.push(300);

    const serialized = serializeTDigest(original);
    const restored = deserializeTDigest(serialized);

    // Restored should give similar percentiles - median should be ~200
    const median = restored.percentile(0.5);
    expect(typeof median).toBe("number");
    expect(median).toBeCloseTo(200, -1); // Within 10
  });

  it("preserves p95 accuracy after serialization", () => {
    const original = createTDigest();
    // Add 100 values from 1 to 100
    for (let i = 1; i <= 100; i++) {
      original.push(i);
    }

    const serialized = serializeTDigest(original);
    const restored = deserializeTDigest(serialized);

    // p95 should be approximately 95
    const p95 = restored.percentile(0.95);
    expect(typeof p95).toBe("number");
    expect(p95).toBeGreaterThanOrEqual(90);
    expect(p95).toBeLessThanOrEqual(100);
  });

  it("handles incremental updates correctly", () => {
    // First batch
    const digest1 = createTDigest();
    digest1.push(100);
    digest1.push(110);

    // Serialize, deserialize, add more
    const serialized1 = serializeTDigest(digest1);
    const digest2 = deserializeTDigest(serialized1);
    digest2.push(120);
    digest2.push(130);

    // Should have values incorporated - median should be around 110-120
    const median = digest2.percentile(0.5);
    expect(typeof median).toBe("number");
    expect(median).toBeGreaterThanOrEqual(105);
    expect(median).toBeLessThanOrEqual(125);
  });
});

describe("incrementHourlyAggregate", () => {
  // Mock database
  let mockDb: ReturnType<typeof createMockDb>;
  let insertedValues: unknown[];
  let existingAggregate: {
    tdigestState: number[] | null;
    minLatencyMs: number | null;
    maxLatencyMs: number | null;
  } | null = null;

  function createMockDb() {
    insertedValues = [];

    const mockInsertChain = {
      values: mock((values: unknown) => {
        insertedValues.push(values);
        return {
          onConflictDoUpdate: mock(() => Promise.resolve()),
        };
      }),
    };

    const mockSelectChain = {
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() =>
            Promise.resolve(existingAggregate ? [existingAggregate] : []),
          ),
        })),
      })),
    };

    return {
      select: mock(() => mockSelectChain),
      insert: mock(() => mockInsertChain),
    };
  }

  beforeEach(() => {
    existingAggregate = null;
    mockDb = createMockDb();
  });

  it("creates new aggregate when none exists", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 150,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(insertedValues).toHaveLength(1);

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.systemId).toBe("sys-1");
    expect(inserted.configurationId).toBe("config-1");
    expect(inserted.bucketSize).toBe("hourly");
    expect(inserted.runCount).toBe(1);
    expect(inserted.healthyCount).toBe(1);
    expect(inserted.degradedCount).toBe(0);
    expect(inserted.unhealthyCount).toBe(0);
    expect(inserted.latencySumMs).toBe(150);
    expect(inserted.minLatencyMs).toBe(150);
    expect(inserted.maxLatencyMs).toBe(150);
  });

  it("writes the environmentId into the aggregate (per-environment fan-out)", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      environmentId: "prod",
      status: "healthy",
      latencyMs: 150,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.environmentId).toBe("prod");
  });

  it("normalizes an env-less run to environmentId = null", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      // environmentId omitted -> env-less run
      status: "healthy",
      latencyMs: 150,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.environmentId).toBeNull();
  });

  it("increments counts for unhealthy status", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "unhealthy",
      latencyMs: 500,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.healthyCount).toBe(0);
    expect(inserted.degradedCount).toBe(0);
    expect(inserted.unhealthyCount).toBe(1);
  });

  it("increments counts for degraded status", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "degraded",
      latencyMs: 300,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.healthyCount).toBe(0);
    expect(inserted.degradedCount).toBe(1);
    expect(inserted.unhealthyCount).toBe(0);
  });

  it("handles undefined latency", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: undefined,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.latencySumMs).toBeUndefined();
    expect(inserted.minLatencyMs).toBeUndefined();
    expect(inserted.maxLatencyMs).toBeUndefined();
    expect(inserted.tdigestState).toBeUndefined();
  });

  it("updates min/max when existing aggregate has values", async () => {
    // Set up existing aggregate
    existingAggregate = {
      tdigestState: serializeTDigest(createTDigest()),
      minLatencyMs: 100,
      maxLatencyMs: 200,
    };
    mockDb = createMockDb();

    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 50, // Lower than existing min
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.minLatencyMs).toBe(50); // Updated to lower value
    expect(inserted.maxLatencyMs).toBe(200); // Unchanged
  });

  it("includes t-digest state for p95 calculation", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 150,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.tdigestState).toBeDefined();
    expect(Array.isArray(inserted.tdigestState)).toBe(true);
    expect(inserted.p95LatencyMs).toBeDefined();
  });

  it("uses correct bucket start time", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 150,
      runTimestamp: new Date("2024-01-15T10:35:42Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    const bucketStart = inserted.bucketStart as Date;
    expect(bucketStart.getTime()).toBe(
      new Date("2024-01-15T10:00:00Z").getTime(),
    );
  });

  it("updates max when new latency is higher", async () => {
    existingAggregate = {
      tdigestState: serializeTDigest(createTDigest()),
      minLatencyMs: 100,
      maxLatencyMs: 200,
    };
    mockDb = createMockDb();

    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 500, // Higher than existing max
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.minLatencyMs).toBe(100); // Unchanged
    expect(inserted.maxLatencyMs).toBe(500); // Updated to higher value
  });

  it("handles zero latency correctly", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 0,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.latencySumMs).toBe(0);
    expect(inserted.minLatencyMs).toBe(0);
    expect(inserted.maxLatencyMs).toBe(0);
  });

  it("handles very large latency values", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 1_000_000, // 1000 seconds
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.latencySumMs).toBe(1_000_000);
  });

  it("accumulates t-digest state across multiple runs", async () => {
    // First run
    const digest1 = createTDigest();
    digest1.push(100);
    digest1.push(200);
    digest1.push(300);

    existingAggregate = {
      tdigestState: serializeTDigest(digest1),
      minLatencyMs: 100,
      maxLatencyMs: 300,
    };
    mockDb = createMockDb();

    // Second run adds a new value
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 150,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.tdigestState).toBeDefined();

    // Deserialize and verify all 4 values are incorporated
    const restoredDigest = deserializeTDigest(
      inserted.tdigestState as number[],
    );
    const size = restoredDigest.size();
    expect(size).toBeGreaterThanOrEqual(1); // At least some centroids

    // Median should be around 175 (average of 100, 150, 200, 300)
    const median = restoredDigest.percentile(0.5);
    expect(median).toBeGreaterThanOrEqual(100);
    expect(median).toBeLessThanOrEqual(300);
  });

  it("handles runs at exact hour boundary", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 100,
      runTimestamp: new Date("2024-01-15T10:00:00.000Z"), // Exact hour
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    const bucketStart = inserted.bucketStart as Date;
    expect(bucketStart.getTime()).toBe(
      new Date("2024-01-15T10:00:00.000Z").getTime(),
    );
  });

  it("handles runs at last millisecond of hour", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 100,
      runTimestamp: new Date("2024-01-15T10:59:59.999Z"), // Last ms of hour
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    const bucketStart = inserted.bucketStart as Date;
    // Should still be in the 10:00 bucket
    expect(bucketStart.getTime()).toBe(
      new Date("2024-01-15T10:00:00.000Z").getTime(),
    );
  });

  it("places runs after hour boundary in next hour", async () => {
    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 100,
      runTimestamp: new Date("2024-01-15T11:00:00.001Z"), // 1ms into next hour
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    const bucketStart = inserted.bucketStart as Date;
    expect(bucketStart.getTime()).toBe(
      new Date("2024-01-15T11:00:00.000Z").getTime(),
    );
  });

  it("handles existing aggregate with null tdigestState", async () => {
    existingAggregate = {
      tdigestState: null,
      minLatencyMs: 100,
      maxLatencyMs: 200,
    };
    mockDb = createMockDb();

    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 150,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.tdigestState).toBeDefined();
    expect(Array.isArray(inserted.tdigestState)).toBe(true);
  });

  it("handles existing aggregate with null min/max latency", async () => {
    existingAggregate = {
      tdigestState: [],
      minLatencyMs: null,
      maxLatencyMs: null,
    };
    mockDb = createMockDb();

    await incrementHourlyAggregate({
      db: mockDb as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 150,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
    });

    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.minLatencyMs).toBe(150);
    expect(inserted.maxLatencyMs).toBe(150);
  });
});

describe("incrementHourlyAggregate - assertion stats folding", () => {
  const KEY = computeAssertionKey({
    assertion: { field: "statusCode", operator: "equals", value: 200 },
  });

  const outcome = (passed: boolean) => ({
    key: KEY,
    field: "statusCode",
    operator: "equals",
    value: "200",
    passed,
  });

  const collectorRegistry = {
    register: mock(() => {}),
    getCollector: mock(() => ({
      collector: {
        id: "test-collector",
        mergeResult: mock(() => ({ count: 1 })),
      },
    })),
    getCollectors: mock(() => []),
  } as unknown as Parameters<
    typeof incrementHourlyAggregate
  >[0]["collectorRegistry"];

  function runResult(outcomes: unknown[]) {
    return {
      metadata: {
        collectors: {
          "uuid-1": {
            _collectorId: "test-collector",
            _assertions: outcomes,
            statusCode: 200,
          },
        },
      },
    };
  }

  it("folds a run's outcomes into the bucket's per-assertion counts", async () => {
    let inserted: Record<string, unknown> | undefined;
    const db = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([])),
          })),
        })),
      })),
      insert: mock(() => ({
        values: mock((values: Record<string, unknown>) => {
          inserted = values;
          return { onConflictDoUpdate: mock(() => Promise.resolve()) };
        }),
      })),
    };

    await incrementHourlyAggregate({
      db: db as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "unhealthy",
      latencyMs: 100,
      runTimestamp: new Date("2024-01-15T10:35:00Z"),
      result: runResult([outcome(true), outcome(false)]) as never,
      collectorRegistry,
    });

    const aggregated = inserted?.aggregatedResult as Record<string, unknown>;
    expect(aggregated.assertions).toEqual({
      "uuid-1": { [KEY]: { passCount: 1, failCount: 1 } },
    });
    // The internal _assertions never leak into collector merge output.
    const collectors = aggregated.collectors as Record<
      string,
      Record<string, unknown>
    >;
    expect(collectors["uuid-1"]._assertions).toBeUndefined();
  });

  it("increments existing counts and keeps distinct keys separate (mid-bucket config edit)", async () => {
    const OTHER_KEY = computeAssertionKey({
      assertion: { field: "statusCode", operator: "equals", value: 201 },
    });
    const existing = {
      tdigestState: null,
      minLatencyMs: null,
      maxLatencyMs: null,
      aggregatedResult: {
        collectors: {},
        assertions: { "uuid-1": { [KEY]: { passCount: 4, failCount: 0 } } },
      },
    };
    let inserted: Record<string, unknown> | undefined;
    const db = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([existing])),
          })),
        })),
      })),
      insert: mock(() => ({
        values: mock((values: Record<string, unknown>) => {
          inserted = values;
          return { onConflictDoUpdate: mock(() => Promise.resolve()) };
        }),
      })),
    };

    // The edited assertion (value 201) starts a NEW series in the same bucket.
    await incrementHourlyAggregate({
      db: db as never,
      systemId: "sys-1",
      configurationId: "config-1",
      status: "healthy",
      latencyMs: 100,
      runTimestamp: new Date("2024-01-15T10:40:00Z"),
      result: runResult([
        { ...outcome(true), key: OTHER_KEY, value: "201" },
      ]) as never,
      collectorRegistry,
    });

    const aggregated = inserted?.aggregatedResult as Record<string, unknown>;
    expect(aggregated.assertions).toEqual({
      "uuid-1": {
        [KEY]: { passCount: 4, failCount: 0 },
        [OTHER_KEY]: { passCount: 1, failCount: 0 },
      },
    });
  });
});
