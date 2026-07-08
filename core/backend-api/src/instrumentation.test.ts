import { describe, it, expect } from "bun:test";
import {
  dbTransactionsCounter,
  dbQueriesCounter,
  dbQueryDurationHistogram,
  dbTransactionDurationHistogram,
  healthcheckExecutionHistogram,
  healthcheckPhaseHistogram,
  queueEnqueuedCounter,
  queueProcessedCounter,
} from "./instrumentation";

/**
 * Without a registered MeterProvider these are OTel no-op instruments, so the
 * contract to pin at the unit level is: each accessor is memoized (one lookup
 * per metric, not a fresh `getMeter().createX` on every hot-path call), and
 * recording is safe (never throws) so the call sites can record
 * unconditionally. Distinctness-by-name only holds once a real provider is
 * registered (the no-op meter returns a single shared no-op instrument per
 * instrument kind) and is covered end-to-end by the Prometheus smoke test.
 */
describe("platform instrumentation accessors", () => {
  it("memoize each instrument (same instance across calls)", () => {
    expect(dbTransactionsCounter()).toBe(dbTransactionsCounter());
    expect(dbQueriesCounter()).toBe(dbQueriesCounter());
    expect(dbQueryDurationHistogram()).toBe(dbQueryDurationHistogram());
    expect(dbTransactionDurationHistogram()).toBe(
      dbTransactionDurationHistogram(),
    );
    expect(healthcheckExecutionHistogram()).toBe(healthcheckExecutionHistogram());
    expect(healthcheckPhaseHistogram()).toBe(healthcheckPhaseHistogram());
    expect(queueEnqueuedCounter()).toBe(queueEnqueuedCounter());
    expect(queueProcessedCounter()).toBe(queueProcessedCounter());
  });

  it("record without throwing when no provider is registered (no-op path)", () => {
    expect(() => {
      dbTransactionsCounter().add(1, { schema: "plugin_test" });
      dbQueriesCounter().add(1, { schema: "plugin_test" });
      dbQueryDurationHistogram().record(12, {
        schema: "plugin_test",
        operation: "select",
      });
      dbTransactionDurationHistogram().record(34, { schema: "plugin_test" });
      healthcheckExecutionHistogram().record(123, { status: "healthy" });
      healthcheckPhaseHistogram().record(45, { phase: "connect" });
      queueEnqueuedCounter().add(1, { queue: "health-checks" });
      queueProcessedCounter().add(1, { queue: "health-checks", status: "completed" });
    }).not.toThrow();
  });
});
