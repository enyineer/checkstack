import type { SeedDb } from "./db.ts";
import { schema } from "./db.ts";
import type { RunnableCheck, RunnableSlo } from "./entities.ts";
import type { HealthProfile } from "../scenario.ts";

/**
 * Synthesize the historic time-series that no public API exposes, writing it
 * straight into the owning plugins' tables so every chart, run list, SLO budget,
 * and anomaly widget renders populated.
 *
 * We replicate exactly what the real write path materializes:
 *  - raw `health_check_runs` for the recent window (run lists + recent charts),
 *  - `health_check_aggregates` hourly (mid-range) and daily (long-range),
 *  - `health_check_state_transitions` (the "in status since" timeline),
 *  - `slo_downtime_events` + `slo_daily_snapshots` + `slo_streaks`,
 *  - `anomaly_baselines` + a few `anomalies`.
 *
 * Statuses/latencies are drawn from a per-check seeded PRNG so raw rows and the
 * aggregates computed over the same windows stay consistent, and screenshots
 * are reproducible run to run.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Recent window captured as raw runs (rich run lists + high-res charts). */
const RAW_DAYS = 3;
const RAW_STEP_MINUTES = 15;
/** Mid-range hourly aggregate coverage. */
const HOURLY_DAYS = 30;
/** Long-range daily aggregate coverage. */
const DAILY_DAYS = 90;

type Status = "healthy" | "degraded" | "unhealthy";

interface Sample {
  status: Status;
  latencyMs: number;
}

/**
 * Deterministic PRNG seeded from a string (Park-Miller minimal-standard LCG).
 * Bitwise-free on purpose so it stays exact within JS safe integers and reads
 * cleanly; quality is more than enough for decorative demo history.
 */
function makeRng(seedStr: string): () => number {
  const MODULUS = 2_147_483_647;
  let state = 0;
  for (const ch of seedStr) {
    state = (state * 31 + (ch.codePointAt(0) ?? 0)) % MODULUS;
  }
  state = state === 0 ? 1 : state;
  return () => {
    state = (state * 16_807) % MODULUS;
    return (state - 1) / (MODULUS - 1);
  };
}

/** Draw a status+latency for a check at a given time, per its health profile. */
function sample({
  profile,
  baseLatencyMs,
  at,
  rng,
}: {
  profile: HealthProfile;
  baseLatencyMs: number;
  at: number;
  rng: () => number;
}): Sample {
  const ageMs = Date.now() - at;
  const roll = rng();
  const jitter = 0.8 + rng() * 0.5;
  let status: Status = "healthy";
  let latency = baseLatencyMs * jitter;

  switch (profile) {
    case "solid": {
      if (roll > 0.998) status = "degraded";
      break;
    }
    case "fast": {
      if (roll > 0.999) status = "degraded";
      latency = baseLatencyMs * (0.7 + rng() * 0.4);
      break;
    }
    case "degraded": {
      if (roll > 0.98) status = "unhealthy";
      else if (roll > 0.9) status = "degraded";
      if (status !== "healthy") latency = baseLatencyMs * (1.8 + rng() * 1.5);
      break;
    }
    case "flapping": {
      if (roll > 0.85) status = "unhealthy";
      if (status === "unhealthy") latency = baseLatencyMs * (1.5 + rng() * 2);
      break;
    }
    case "recent-outage": {
      // A sharp ~2h unhealthy window centered ~26h ago; healthy otherwise.
      const outageStart = 27 * HOUR;
      const outageEnd = 25 * HOUR;
      if (ageMs <= outageStart && ageMs >= outageEnd) {
        status = roll > 0.2 ? "unhealthy" : "degraded";
        latency = baseLatencyMs * (2.5 + rng() * 2);
      } else if (roll > 0.995) {
        status = "degraded";
      }
      break;
    }
  }
  return { status, latencyMs: Math.round(latency) };
}

/**
 * Shape a run's `result` jsonb the way the real collector write path does, so
 * the run-detail panel renders a populated metric strip + timing waterfall
 * (`status`, `latencyMs`, `metadata.timings`) instead of "Undefined" / "—". For
 * HTTP checks we also carry a `statusCode` so the seeded `statusCode eq 200`
 * assertion has a value to evaluate on the Assertions tab.
 */
function buildRunResult({
  strategyId,
  sample,
}: {
  strategyId: string;
  sample: Sample;
}): Record<string, unknown> {
  // Split the latency into transport phases the run-detail waterfall renders,
  // in RunTimingsSchema's keys (dns -> connect -> tls -> wait -> transfer).
  const isHttp = strategyId === "healthcheck-http.http";
  const isTls = strategyId === "healthcheck-tls.tls" || isHttp;
  const dnsMs = Math.round(sample.latencyMs * 0.1);
  const connectMs = Math.round(sample.latencyMs * 0.2);
  const tlsMs = isTls ? Math.round(sample.latencyMs * 0.15) : undefined;
  const transferMs = Math.round(sample.latencyMs * 0.15);
  const accounted = dnsMs + connectMs + (tlsMs ?? 0) + transferMs;
  const waitMs = Math.max(0, sample.latencyMs - accounted);
  const result: Record<string, unknown> = {
    status: sample.status,
    latencyMs: sample.latencyMs,
    metadata: {
      timings: {
        dnsMs,
        connectMs,
        ...(tlsMs === undefined ? {} : { tlsMs }),
        waitMs,
        transferMs,
      },
    },
  };
  if (isHttp) {
    result.statusCode = sample.status === "unhealthy" ? 503 : 200;
    result.statusText = sample.status === "unhealthy" ? "Service Unavailable" : "OK";
  }
  return result;
}

function aggregateSamples(samples: Sample[]) {
  const latencies = samples.map((s) => s.latencyMs).toSorted((a, b) => a - b);
  const sum = latencies.reduce((acc, n) => acc + n, 0);
  const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
  return {
    runCount: samples.length,
    healthyCount: samples.filter((s) => s.status === "healthy").length,
    degradedCount: samples.filter((s) => s.status === "degraded").length,
    unhealthyCount: samples.filter((s) => s.status === "unhealthy").length,
    latencySumMs: sum,
    avgLatencyMs: Math.round(sum / Math.max(1, latencies.length)),
    minLatencyMs: latencies[0] ?? 0,
    maxLatencyMs: latencies.at(-1) ?? 0,
    p95LatencyMs: latencies[p95Index] ?? 0,
  };
}

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await insert(rows.slice(i, i + CHUNK));
  }
}

export async function seedHistory({
  db,
  checks,
  slos,
}: {
  db: SeedDb;
  checks: RunnableCheck[];
  slos: RunnableSlo[];
}): Promise<void> {
  await seedRuns({ db, checks });
  await seedAggregates({ db, checks });
  await seedTransitions({ db, checks });
  await seedSlo({ db, slos });
  await seedAnomaly({ db, checks });
}

async function seedRuns({ db, checks }: { db: SeedDb; checks: RunnableCheck[] }) {
  const now = Date.now();
  const runs: (typeof schema.healthCheckRuns.$inferInsert)[] = [];
  for (const check of checks) {
    for (const environmentId of check.environmentIds) {
      const rng = makeRng(`${check.configurationId}:${environmentId}:raw`);
      for (let t = now - RAW_DAYS * DAY; t <= now; t += RAW_STEP_MINUTES * MINUTE) {
        const s = sample({
          profile: check.healthProfile,
          baseLatencyMs: check.baseLatencyMs,
          at: t,
          rng,
        });
        runs.push({
          configurationId: check.configurationId,
          systemId: check.systemId,
          environmentId,
          status: s.status,
          latencyMs: s.latencyMs,
          // The run-detail panel reads status/latency/timings from INSIDE the
          // `result` jsonb (not the columns), so mirror the real write path: a
          // populated result gives a filled metric strip, timing waterfall, and
          // - for HTTP - a statusCode the seeded assertion evaluates against.
          result: buildRunResult({ strategyId: check.strategyId, sample: s }),
          sourceLabel: "Local",
          timestamp: new Date(t),
        });
      }
    }
  }
  await insertChunked(runs, (chunk) => db.insert(schema.healthCheckRuns).values(chunk));
}

async function seedAggregates({
  db,
  checks,
}: {
  db: SeedDb;
  checks: RunnableCheck[];
}) {
  const now = Date.now();
  const rows: (typeof schema.healthCheckAggregates.$inferInsert)[] = [];

  const build = (
    check: RunnableCheck,
    environmentId: string,
    bucketStartMs: number,
    bucketMs: number,
    bucketSize: "hourly" | "daily",
    stepMinutes: number,
  ) => {
    const rng = makeRng(`${check.configurationId}:${environmentId}:${bucketSize}:${bucketStartMs}`);
    const samples: Sample[] = [];
    for (let t = bucketStartMs; t < bucketStartMs + bucketMs; t += stepMinutes * MINUTE) {
      samples.push(
        sample({ profile: check.healthProfile, baseLatencyMs: check.baseLatencyMs, at: t, rng }),
      );
    }
    return {
      configurationId: check.configurationId,
      systemId: check.systemId,
      environmentId,
      bucketStart: new Date(bucketStartMs),
      bucketSize,
      ...aggregateSamples(samples),
    } satisfies typeof schema.healthCheckAggregates.$inferInsert;
  };

  for (const check of checks) {
    for (const environmentId of check.environmentIds) {
      // Hourly buckets across HOURLY_DAYS.
      const hourlyStart = Math.floor((now - HOURLY_DAYS * DAY) / HOUR) * HOUR;
      for (let b = hourlyStart; b < now; b += HOUR) {
        rows.push(build(check, environmentId, b, HOUR, "hourly", 10));
      }
      // Daily buckets across DAILY_DAYS.
      const dailyStart = Math.floor((now - DAILY_DAYS * DAY) / DAY) * DAY;
      for (let b = dailyStart; b < now - HOURLY_DAYS * DAY; b += DAY) {
        rows.push(build(check, environmentId, b, DAY, "daily", 60));
      }
    }
  }
  await insertChunked(rows, (chunk) =>
    db.insert(schema.healthCheckAggregates).values(chunk).onConflictDoNothing(),
  );
}

async function seedTransitions({
  db,
  checks,
}: {
  db: SeedDb;
  checks: RunnableCheck[];
}) {
  const now = Date.now();
  const rows: (typeof schema.healthCheckStateTransitions.$inferInsert)[] = [];
  for (const check of checks) {
    for (const environmentId of check.environmentIds) {
      // Initial healthy transition far in the past so "in status since" reads.
      rows.push({
        systemId: check.systemId,
        configurationId: check.configurationId,
        environmentId,
        fromStatus: null,
        toStatus: "healthy",
        transitionedAt: new Date(now - DAILY_DAYS * DAY),
      });
      if (check.healthProfile === "recent-outage") {
        rows.push(
          {
            systemId: check.systemId,
            configurationId: check.configurationId,
            environmentId,
            fromStatus: "healthy",
            toStatus: "unhealthy",
            transitionedAt: new Date(now - 27 * HOUR),
          },
          {
            systemId: check.systemId,
            configurationId: check.configurationId,
            environmentId,
            fromStatus: "unhealthy",
            toStatus: "healthy",
            transitionedAt: new Date(now - 25 * HOUR),
          },
        );
      }
    }
  }
  await insertChunked(rows, (chunk) =>
    db.insert(schema.healthCheckStateTransitions).values(chunk),
  );
}

async function seedSlo({ db, slos }: { db: SeedDb; slos: RunnableSlo[] }) {
  const now = Date.now();
  const events: (typeof schema.sloDowntimeEvents.$inferInsert)[] = [];
  const snapshots: (typeof schema.sloDailySnapshots.$inferInsert)[] = [];
  const streaks: (typeof schema.sloStreaks.$inferInsert)[] = [];

  for (const slo of slos) {
    // A couple of closed downtime events over the window.
    const outages = [
      { start: now - 26 * HOUR, durationMin: 90, attribution: "self" as const },
      { start: now - 12 * DAY, durationMin: 25, attribution: "upstream" as const },
    ];
    for (const outage of outages) {
      const durationSeconds = outage.durationMin * 60;
      events.push({
        id: crypto.randomUUID(),
        objectiveId: slo.sloId,
        systemId: slo.systemId,
        startTime: new Date(outage.start),
        endTime: new Date(outage.start + durationSeconds * 1000),
        durationSeconds,
        attributionType: outage.attribution,
      });
    }

    // Daily snapshots across the window for the trend chart.
    const budgetMinutes = (1 - slo.target / 100) * slo.windowDays * 24 * 60;
    let consumed = 0;
    for (let d = slo.windowDays - 1; d >= 0; d--) {
      const dayStart = now - d * DAY;
      const outageMin = outages
        .filter((o) => o.start >= dayStart - DAY && o.start < dayStart)
        .reduce((acc, o) => acc + o.durationMin, 0);
      consumed += outageMin;
      const availability = 100 - (outageMin / (24 * 60)) * 100;
      snapshots.push({
        id: crypto.randomUUID(),
        objectiveId: slo.sloId,
        date: new Date(dayStart),
        availabilityPercent: Number(availability.toFixed(4)),
        budgetConsumedMinutes: Number(consumed.toFixed(2)),
        budgetRemainingPercent: Number(
          Math.max(0, 100 - (consumed / Math.max(1, budgetMinutes)) * 100).toFixed(2),
        ),
        burnRate: outageMin > 0 ? Number((outageMin / (budgetMinutes / slo.windowDays)).toFixed(2)) : 0,
        streakDays: 0,
      });
    }

    streaks.push({
      objectiveId: slo.sloId,
      systemId: slo.systemId,
      currentStreak: 1,
      bestStreak: 11,
      streakStart: new Date(now - 1 * DAY),
      bestStreakEnd: new Date(now - 13 * DAY),
    });
  }

  if (events.length > 0) await db.insert(schema.sloDowntimeEvents).values(events);
  if (snapshots.length > 0)
    await insertChunked(snapshots, (chunk) =>
      db.insert(schema.sloDailySnapshots).values(chunk),
    );
  // The SLO engine seeds a default streak row when an objective is created, so
  // upsert our richer values onto it rather than colliding on the PK.
  for (const streak of streaks) {
    await db
      .insert(schema.sloStreaks)
      .values(streak)
      .onConflictDoUpdate({
        target: schema.sloStreaks.objectiveId,
        set: {
          currentStreak: streak.currentStreak,
          bestStreak: streak.bestStreak,
          streakStart: streak.streakStart,
          bestStreakEnd: streak.bestStreakEnd,
        },
      });
  }
}

async function seedAnomaly({
  db,
  checks,
}: {
  db: SeedDb;
  checks: RunnableCheck[];
}) {
  const now = Date.now();
  const baselines: (typeof schema.anomalyBaselines.$inferInsert)[] = [];
  const anomalies: (typeof schema.anomalies.$inferInsert)[] = [];

  for (const check of checks) {
    for (const environmentId of check.environmentIds) {
      baselines.push({
        systemId: check.systemId,
        configurationId: check.configurationId,
        environmentId,
        fieldPath: "latencyMs",
        mean: check.baseLatencyMs,
        stdDev: Math.max(1, check.baseLatencyMs * 0.15),
        trendSlope: 0,
        sampleCount: 500,
        computedAt: new Date(now - HOUR),
      });
    }
    // Surface a couple of live anomalies on the noisier checks.
    if (check.healthProfile === "degraded" || check.healthProfile === "flapping") {
      anomalies.push({
        systemId: check.systemId,
        configurationId: check.configurationId,
        environmentId: check.environmentIds[0] ?? null,
        fieldPath: "latencyMs",
        state: "anomaly",
        direction: "above",
        kind: "spike",
        baselineValue: check.baseLatencyMs,
        observedValue: String(Math.round(check.baseLatencyMs * 2.4)),
        deviation: 3.1,
        confirmationThreshold: 3,
        startedAt: new Date(now - 4 * HOUR),
        confirmedAt: new Date(now - 3.5 * HOUR),
      });
    }
  }

  if (baselines.length > 0)
    await insertChunked(baselines, (chunk) =>
      db.insert(schema.anomalyBaselines).values(chunk).onConflictDoNothing(),
    );
  if (anomalies.length > 0)
    await insertChunked(anomalies, (chunk) => db.insert(schema.anomalies).values(chunk));
}
