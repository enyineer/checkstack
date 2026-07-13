import { describe, expect, it, mock } from "bun:test";
import {
  createInvalidationCoalescer,
  type TimerScheduler,
} from "./invalidation-coalescer";

/**
 * Deterministic scheduler: timers never fire on their own. The test drives time
 * by calling `elapse()`, which fires every currently-pending timer once (i.e.
 * simulates the trailing window elapsing). No real sleeps.
 */
function createManualScheduler(): {
  scheduler: TimerScheduler<number>;
  elapse: () => void;
  pendingCount: () => number;
} {
  let nextId = 1;
  const tasks = new Map<number, () => void>();

  const scheduler: TimerScheduler<number> = {
    set: ({ handler }) => {
      const id = nextId++;
      tasks.set(id, handler);
      return id;
    },
    clear: ({ handle }) => {
      tasks.delete(handle);
    },
  };

  return {
    scheduler,
    elapse: () => {
      const handlers = [...tasks.values()];
      tasks.clear();
      for (const handler of handlers) handler();
    },
    pendingCount: () => tasks.size,
  };
}

interface Job {
  pluginId: string;
  resourceId?: string;
}

/** Same bucketing rule the invalidator uses: blanket keys on pluginId, a
 *  resource-scoped job keys on pluginId + resourceId. */
const keyOf = (job: Job): string =>
  job.resourceId === undefined
    ? job.pluginId
    : `${job.pluginId}::${job.resourceId}`;

describe("createInvalidationCoalescer", () => {
  it("flushes once for N rapid schedules of the same bucket", () => {
    const { scheduler, elapse, pendingCount } = createManualScheduler();
    const flush = mock<(props: { job: Job }) => void>(() => {});
    const coalescer = createInvalidationCoalescer<Job, number>({
      flush,
      keyOf,
      windowMs: 300,
      scheduler,
    });

    for (let i = 0; i < 5; i++)
      coalescer.schedule({ job: { pluginId: "healthcheck" } });

    // Each schedule resets the timer, so only one timer is ever pending.
    expect(pendingCount()).toBe(1);

    elapse();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith({ job: { pluginId: "healthcheck" } });
  });

  it("flushes once per distinct bucket", () => {
    const { scheduler, elapse, pendingCount } = createManualScheduler();
    const flush = mock<(props: { job: Job }) => void>(() => {});
    const coalescer = createInvalidationCoalescer<Job, number>({
      flush,
      keyOf,
      windowMs: 300,
      scheduler,
    });

    coalescer.schedule({ job: { pluginId: "healthcheck" } });
    coalescer.schedule({ job: { pluginId: "incident" } });
    coalescer.schedule({ job: { pluginId: "maintenance" } });

    expect(pendingCount()).toBe(3);

    elapse();

    expect(flush).toHaveBeenCalledTimes(3);
    const targets = flush.mock.calls.map(([{ job }]) => job.pluginId).sort();
    expect(targets).toEqual(["healthcheck", "incident", "maintenance"]);
  });

  it("keeps distinct resources of the same plugin in independent buckets", () => {
    const { scheduler, elapse, pendingCount } = createManualScheduler();
    const flush = mock<(props: { job: Job }) => void>(() => {});
    const coalescer = createInvalidationCoalescer<Job, number>({
      flush,
      keyOf,
      windowMs: 300,
      scheduler,
    });

    // A burst for stream A and a burst for stream B on the same plugin.
    coalescer.schedule({ job: { pluginId: "logstream", resourceId: "a" } });
    coalescer.schedule({ job: { pluginId: "logstream", resourceId: "a" } });
    coalescer.schedule({ job: { pluginId: "logstream", resourceId: "b" } });

    // Two buckets - one per resource - not one collapsed blanket bucket.
    expect(pendingCount()).toBe(2);

    elapse();

    expect(flush).toHaveBeenCalledTimes(2);
    const resourceIds = flush.mock.calls
      .map(([{ job }]) => job.resourceId)
      .sort();
    expect(resourceIds).toEqual(["a", "b"]);
  });

  it("tracks a blanket and a resource-scoped job for one plugin separately", () => {
    const { scheduler, pendingCount } = createManualScheduler();
    const flush = mock<(props: { job: Job }) => void>(() => {});
    const coalescer = createInvalidationCoalescer<Job, number>({
      flush,
      keyOf,
      windowMs: 300,
      scheduler,
    });

    coalescer.schedule({ job: { pluginId: "logstream" } });
    coalescer.schedule({ job: { pluginId: "logstream", resourceId: "a" } });

    // The blanket bucket and the resource bucket do not collapse together.
    expect(pendingCount()).toBe(2);
  });

  it("flushes the LAST job scheduled for a bucket", () => {
    const { scheduler, elapse } = createManualScheduler();
    const flush = mock<(props: { job: Job }) => void>(() => {});
    const coalescer = createInvalidationCoalescer<Job, number>({
      flush,
      keyOf,
      windowMs: 300,
      scheduler,
    });

    // Same bucket key (blanket for logstream); the second job wins.
    coalescer.schedule({ job: { pluginId: "logstream", resourceId: undefined } });
    coalescer.schedule({ job: { pluginId: "logstream" } });
    elapse();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith({ job: { pluginId: "logstream" } });
  });

  it("flushes again for a schedule after a prior flush", () => {
    const { scheduler, elapse } = createManualScheduler();
    const flush = mock<(props: { job: Job }) => void>(() => {});
    const coalescer = createInvalidationCoalescer<Job, number>({
      flush,
      keyOf,
      windowMs: 300,
      scheduler,
    });

    coalescer.schedule({ job: { pluginId: "healthcheck" } });
    elapse();
    expect(flush).toHaveBeenCalledTimes(1);

    coalescer.schedule({ job: { pluginId: "healthcheck" } });
    elapse();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels a pending flush", () => {
    const { scheduler, elapse, pendingCount } = createManualScheduler();
    const flush = mock<(props: { job: Job }) => void>(() => {});
    const coalescer = createInvalidationCoalescer<Job, number>({
      flush,
      keyOf,
      windowMs: 300,
      scheduler,
    });

    coalescer.schedule({ job: { pluginId: "healthcheck" } });
    coalescer.dispose();

    expect(pendingCount()).toBe(0);

    elapse();

    expect(flush).not.toHaveBeenCalled();
  });
});
