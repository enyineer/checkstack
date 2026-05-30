/**
 * Behaviour tests for the built-in `time.cron`, `time.interval`, and
 * `template` triggers.
 *
 * Each test exercises one factory, fakes out the queue, runs setup()
 * to register a fire-callback in the module-scoped tick map, and then
 * either (a) inspects the queue arguments, or (b) plays a tick through
 * the recorded callback to verify the fire behaviour (including the
 * template trigger's false → true edge detection).
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

import {
  _resetBuiltinTriggerTickHandlersForTests,
  BUILTIN_TRIGGER_QUEUE,
  createNumericStateTrigger,
  createTemplateTrigger,
  createTimeCronTrigger,
  createTimeIntervalTrigger,
  registerBuiltinTriggerConsumer,
  type BuiltinTriggerTickPayload,
} from "./builtin-triggers";

interface FakeJob {
  id: string;
  data: BuiltinTriggerTickPayload;
  timestamp: Date;
}

function tick(jobId: string): FakeJob {
  return {
    id: jobId,
    data: { jobId },
    timestamp: new Date(),
  };
}

const logger = createMockLogger() as Logger;

interface QueueFixture {
  queueManager: QueueManager;
  scheduleMock: ReturnType<typeof mock>;
  cancelMock: ReturnType<typeof mock>;
  consumeMock: ReturnType<typeof mock>;
  /** Last consumer registered via `queue.consume`. */
  consumer?: (job: FakeJob) => Promise<void>;
}

function makeQueueFixture(): QueueFixture {
  const fixture: QueueFixture = {
    queueManager: undefined as never,
    scheduleMock: mock(async (_payload: unknown, options: { jobId: string }) =>
      options.jobId,
    ),
    cancelMock: mock(async (_jobId: string) => undefined),
    consumeMock: mock(async () => undefined),
  };
  fixture.consumeMock = mock(
    async (consumer: (job: FakeJob) => Promise<void>) => {
      fixture.consumer = consumer;
    },
  );
  const queue = {
    scheduleRecurring: fixture.scheduleMock,
    cancelRecurring: fixture.cancelMock,
    consume: fixture.consumeMock,
  };
  fixture.queueManager = {
    getQueue: () => queue,
  } as unknown as QueueManager;
  return fixture;
}

beforeEach(() => {
  _resetBuiltinTriggerTickHandlersForTests();
});

describe("automation.cron", () => {
  it("schedules a recurring cron job and fires on each tick", async () => {
    const fx = makeQueueFixture();
    await registerBuiltinTriggerConsumer({
      queueManager: fx.queueManager,
      logger,
    });
    const fired: Array<{ firedAt: string }> = [];
    const fire = mock(async (payload: unknown) => {
      fired.push(payload as { firedAt: string });
    });

    const trigger = createTimeCronTrigger({ queueManager: fx.queueManager });
    const teardown = await trigger.setup!({
      config: { cronPattern: "*/5 * * * *" },
      identity: { automationId: "auto-1", triggerId: "t-1" },
      fire,
      logger,
    });

    expect(fx.scheduleMock).toHaveBeenCalledTimes(1);
    const [scheduleData, scheduleOptions] = fx.scheduleMock.mock.calls[0] as [
      BuiltinTriggerTickPayload,
      { jobId: string; cronPattern?: string },
    ];
    expect(scheduleData.jobId).toBe("builtin:cron:auto-1:t-1");
    expect(scheduleOptions.cronPattern).toBe("*/5 * * * *");

    // The consumer was registered first; play a tick through it and
    // confirm the fire-callback ran.
    expect(fx.consumer).toBeDefined();
    await fx.consumer!(tick("builtin:cron:auto-1:t-1"));
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fired[0]?.firedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Teardown cancels the recurring job + drops the handler.
    await teardown();
    expect(fx.cancelMock).toHaveBeenCalledWith("builtin:cron:auto-1:t-1");
    await fx.consumer!(tick("builtin:cron:auto-1:t-1"));
    // No additional fire after teardown — handler was removed.
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("scopes the jobId by (automationId, triggerId)", async () => {
    const fx = makeQueueFixture();
    const trigger = createTimeCronTrigger({ queueManager: fx.queueManager });
    const teardownA = await trigger.setup!({
      config: { cronPattern: "0 * * * *" },
      identity: { automationId: "auto-A", triggerId: "x" },
      fire: mock(async () => {}),
      logger,
    });
    const teardownB = await trigger.setup!({
      config: { cronPattern: "0 * * * *" },
      identity: { automationId: "auto-B", triggerId: "x" },
      fire: mock(async () => {}),
      logger,
    });
    const jobIds = fx.scheduleMock.mock.calls.map(
      (c) => (c[1] as { jobId: string }).jobId,
    );
    expect(jobIds).toContain("builtin:cron:auto-A:x");
    expect(jobIds).toContain("builtin:cron:auto-B:x");
    await teardownA();
    await teardownB();
  });
});

describe("automation.interval", () => {
  it("schedules a recurring interval job with a startDelay equal to the interval", async () => {
    const fx = makeQueueFixture();
    await registerBuiltinTriggerConsumer({
      queueManager: fx.queueManager,
      logger,
    });
    const fire = mock(async (_payload: unknown) => {});

    const trigger = createTimeIntervalTrigger({
      queueManager: fx.queueManager,
    });
    const teardown = await trigger.setup!({
      config: { intervalSeconds: 30 },
      identity: { automationId: "auto-1", triggerId: "t-1" },
      fire,
      logger,
    });

    const [, scheduleOptions] = fx.scheduleMock.mock.calls[0] as [
      BuiltinTriggerTickPayload,
      { jobId: string; intervalSeconds?: number; startDelay?: number },
    ];
    expect(scheduleOptions.intervalSeconds).toBe(30);
    expect(scheduleOptions.startDelay).toBe(30);

    await fx.consumer!(tick("builtin:interval:auto-1:t-1"));
    expect(fire).toHaveBeenCalledTimes(1);

    await teardown();
  });
});

describe("automation.template", () => {
  it("fires only on the false → true edge", async () => {
    const fx = makeQueueFixture();
    await registerBuiltinTriggerConsumer({
      queueManager: fx.queueManager,
      logger,
    });
    const fire = mock(async (_payload: unknown) => {});

    // Use a template that toggles based on a flag in the closure.
    // Since the trigger only has access to `{ now }`, we simulate the
    // edge by switching the template via two separate setup calls.
    const trigger = createTemplateTrigger({ queueManager: fx.queueManager });
    const teardown = await trigger.setup!({
      // Truthy from the start. We expect:
      //  tick 1 → previousTruthy was false → fire.
      //  tick 2 → previousTruthy is now true → no fire.
      config: { value_template: "true", intervalSeconds: 5 },
      identity: { automationId: "auto-1", triggerId: "t-1" },
      fire,
      logger,
    });

    await fx.consumer!(tick("builtin:template:auto-1:t-1"));
    await fx.consumer!(tick("builtin:template:auto-1:t-1"));
    expect(fire).toHaveBeenCalledTimes(1);

    await teardown();
  });

  it("does not fire when the template is always falsy", async () => {
    const fx = makeQueueFixture();
    await registerBuiltinTriggerConsumer({
      queueManager: fx.queueManager,
      logger,
    });
    const fire = mock(async (_payload: unknown) => {});

    const trigger = createTemplateTrigger({ queueManager: fx.queueManager });
    const teardown = await trigger.setup!({
      config: { value_template: "false", intervalSeconds: 5 },
      identity: { automationId: "auto-1", triggerId: "t-1" },
      fire,
      logger,
    });

    await fx.consumer!(tick("builtin:template:auto-1:t-1"));
    await fx.consumer!(tick("builtin:template:auto-1:t-1"));
    expect(fire).not.toHaveBeenCalled();

    await teardown();
  });

  it("rejects an invalid template at setup time", async () => {
    const fx = makeQueueFixture();
    const trigger = createTemplateTrigger({ queueManager: fx.queueManager });
    await expect(
      trigger.setup!({
        config: { value_template: "((((", intervalSeconds: 5 },
        identity: { automationId: "auto-1", triggerId: "t-1" },
        fire: mock(async () => {}),
        logger,
      }),
    ).rejects.toThrow(/invalid value_template/);
    expect(fx.scheduleMock).not.toHaveBeenCalled();
  });
});

describe("builtin trigger consumer", () => {
  it("logs but does not throw when a tick arrives without a registered handler", async () => {
    const fx = makeQueueFixture();
    await registerBuiltinTriggerConsumer({
      queueManager: fx.queueManager,
      logger,
    });
    await expect(
      fx.consumer!(tick("builtin:cron:unregistered:nope")),
    ).resolves.toBeUndefined();
  });

  it("uses the shared queue name", () => {
    expect(BUILTIN_TRIGGER_QUEUE).toBe("automation-builtin-triggers");
  });
});

describe("numeric_state trigger", () => {
  const trigger = createNumericStateTrigger();

  it("is hook-backed on healthcheck.check.completed", () => {
    expect(trigger.hook?.id).toBe("healthcheck.check.completed");
    expect(trigger.setup).toBeUndefined();
  });

  it("extracts systemId as the context key", () => {
    expect(
      trigger.contextKey?.({
        systemId: "sys-1",
        configurationId: "c",
        status: "unhealthy",
        field: "latencyMs",
        value: 1,
      }),
    ).toBe("sys-1");
  });

  it("evaluateConfig fires when top-level latencyMs is above the bound", () => {
    const payload = {
      systemId: "sys-1",
      configurationId: "c",
      status: "degraded",
      latencyMs: 600,
    } as unknown as Parameters<NonNullable<typeof trigger.evaluateConfig>>[0];
    expect(
      trigger.evaluateConfig!(payload, { field: "latencyMs", above: 500 }),
    ).toBe(true);
    expect(
      trigger.evaluateConfig!(payload, { field: "latencyMs", above: 700 }),
    ).toBe(false);
  });

  it("evaluateConfig reads a collector field under result (collectors map)", () => {
    const payload = {
      systemId: "sys-1",
      configurationId: "c",
      status: "healthy",
      result: { http: { responseTimeMs: 120 } },
    } as unknown as Parameters<NonNullable<typeof trigger.evaluateConfig>>[0];
    expect(
      trigger.evaluateConfig!(payload, {
        field: "collectors.http.responseTimeMs",
        below: 200,
      }),
    ).toBe(true);
    expect(
      trigger.evaluateConfig!(payload, {
        field: "collectors.http.responseTimeMs",
        below: 100,
      }),
    ).toBe(false);
  });

  it("evaluateConfig is false when the field is missing", () => {
    const payload = {
      systemId: "sys-1",
      configurationId: "c",
      status: "healthy",
    } as unknown as Parameters<NonNullable<typeof trigger.evaluateConfig>>[0];
    expect(
      trigger.evaluateConfig!(payload, { field: "latencyMs", above: 1 }),
    ).toBe(false);
  });
});
