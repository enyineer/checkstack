#!/usr/bin/env bun
/**
 * Queue Load Benchmark Script
 *
 * Run manually to measure queue throughput at various concurrency levels:
 *
 *   cd plugins/queue-memory-backend
 *   bun run src/benchmark.ts
 *
 * This is NOT a test file - it runs benchmarks and prints results.
 *
 * INTENTIONAL console.* usage: this is a standalone CLI report tool whose
 * entire purpose is to print a human-readable benchmark table to stdout.
 * `console.*` IS the output here, not stray debug logging, so the structured
 * `Logger` abstraction used by the rest of the backend does not apply. The
 * `no-console` lint rule is scoped to frontend packages and does not flag this
 * backend script; the console calls below are deliberate and must stay.
 */

import { InMemoryQueue } from "./memory-queue";
import type { Logger } from "@checkstack/backend-api";

const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Simulate an I/O-bound job (like a health check)
 */
async function simulateIOWork(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedValues: number[], p: number): number {
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

interface LoadTestResult {
  concurrency: number;
  totalJobs: number;
  durationMs: number;
  jobsPerSecond: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

/**
 * Run a load test at a specific concurrency level
 */
async function runLoadTest(props: {
  concurrency: number;
  totalJobs: number;
  jobDurationMs: number;
}): Promise<LoadTestResult> {
  const { concurrency, totalJobs, jobDurationMs } = props;

  const queue = new InMemoryQueue<number>(
    `load-test-${concurrency}`,
    {
      concurrency,
      maxQueueSize: totalJobs + 100,
      delayMultiplier: 1,
      heartbeatIntervalMs: 0,
    },
    testLogger,
  );

  const latencies: number[] = [];
  let completed = 0;
  const startTimes = new Map<number, number>();

  await queue.consume(
    async (job) => {
      const jobStart = startTimes.get(job.data) ?? Date.now();
      await simulateIOWork(jobDurationMs);
      const latency = Date.now() - jobStart;
      latencies.push(latency);
      completed++;
    },
    { consumerGroup: "load-test-group", maxRetries: 0 },
  );

  const testStart = Date.now();
  for (let i = 0; i < totalJobs; i++) {
    startTimes.set(i, Date.now());
    await queue.enqueue(i);
  }

  while (completed < totalJobs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const testDuration = Date.now() - testStart;

  await queue.stop();

  const sortedLatencies = latencies.toSorted((a, b) => a - b);
  const avgLatency =
    latencies.reduce((sum, l) => sum + l, 0) / latencies.length;

  return {
    concurrency,
    totalJobs,
    durationMs: testDuration,
    jobsPerSecond: (totalJobs / testDuration) * 1000,
    avgLatencyMs: Math.round(avgLatency),
    p50LatencyMs: percentile(sortedLatencies, 50),
    p95LatencyMs: percentile(sortedLatencies, 95),
    p99LatencyMs: percentile(sortedLatencies, 99),
  };
}

function formatResult(result: LoadTestResult): string {
  return [
    `Concurrency: ${result.concurrency}`,
    `  Jobs: ${result.totalJobs} in ${result.durationMs}ms`,
    `  Throughput: ${result.jobsPerSecond.toFixed(1)} jobs/sec`,
    `  Latency: avg=${result.avgLatencyMs}ms, p50=${result.p50LatencyMs}ms, p95=${result.p95LatencyMs}ms, p99=${result.p99LatencyMs}ms`,
  ].join("\n");
}

// Main benchmark runner
async function main() {
  console.log("\n🚀 Queue Load Benchmark\n");
  console.log("=".repeat(60));

  // Test 1: Fast jobs
  console.log("\n📊 Fast Jobs (10ms simulated I/O)\n");
  for (const concurrency of [5, 10, 25, 50]) {
    const result = await runLoadTest({
      concurrency,
      totalJobs: 100,
      jobDurationMs: 10,
    });
    console.log(formatResult(result));
    console.log("-".repeat(60));
  }

  // Test 2: Realistic jobs
  console.log("\n📊 Realistic Jobs (50ms simulated I/O)\n");
  for (const concurrency of [5, 10, 25, 50]) {
    const result = await runLoadTest({
      concurrency,
      totalJobs: 100,
      jobDurationMs: 50,
    });
    console.log(formatResult(result));
    console.log("-".repeat(60));
  }

  // Test 3: Slow jobs showing concurrency benefit
  console.log("\n📊 Slow Jobs (200ms) - Demonstrating Concurrency Benefits\n");
  const results: LoadTestResult[] = [];
  for (const concurrency of [1, 5, 10, 25]) {
    const result = await runLoadTest({
      concurrency,
      totalJobs: 50,
      jobDurationMs: 200,
    });
    results.push(result);
    console.log(formatResult(result));
    console.log("-".repeat(60));
  }
  const sequential = results.find((r) => r.concurrency === 1)!;
  const parallel = results.find((r) => r.concurrency === 25)!;
  console.log(
    `\n✨ Speedup: ${(sequential.durationMs / parallel.durationMs).toFixed(
      1,
    )}x faster with concurrency=25`,
  );

  // Test 4: Burst load
  console.log("\n📊 Burst Load (500 jobs at once)\n");
  const burstResult = await runLoadTest({
    concurrency: 50,
    totalJobs: 500,
    jobDurationMs: 20,
  });
  console.log(formatResult(burstResult));

  // Test 5: Max throughput
  console.log("\n📊 Max Throughput (minimal job duration)\n");
  const maxResult = await runLoadTest({
    concurrency: 100,
    totalJobs: 1000,
    jobDurationMs: 1,
  });
  console.log(formatResult(maxResult));
  console.log(
    `\n✨ Max throughput: ${maxResult.jobsPerSecond.toFixed(0)} jobs/sec`,
  );

  // Capacity planning guidance
  console.log("\n" + "=".repeat(60));
  console.log("📋 CAPACITY PLANNING GUIDANCE");
  console.log("=".repeat(60));
  console.log(`
Throughput Formula: jobs/sec ≈ concurrency / avg_job_duration_seconds

Concurrency Settings:
  - Default: 10 (conservative)
  - Moderate: 25-50 (I/O-bound checks)
  - Aggressive: 100 (max, watch resources)

Bottlenecks: DB pool, rate limits, memory, sockets

Recommendations:
  - Start with concurrency=10
  - Increase if jobs queue but CPU/memory low
  - Use BullMQ for horizontal scaling
`);
}

await main();
