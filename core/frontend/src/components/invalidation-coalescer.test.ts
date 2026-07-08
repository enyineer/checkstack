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

describe("createInvalidationCoalescer", () => {
  it("flushes once for N rapid schedules of the same target", () => {
    const { scheduler, elapse, pendingCount } = createManualScheduler();
    const flush = mock<(props: { target: string }) => void>(() => {});
    const coalescer = createInvalidationCoalescer({
      flush,
      windowMs: 300,
      scheduler,
    });

    for (let i = 0; i < 5; i++) coalescer.schedule({ target: "healthcheck" });

    // Each schedule resets the timer, so only one timer is ever pending.
    expect(pendingCount()).toBe(1);

    elapse();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith({ target: "healthcheck" });
  });

  it("flushes once per distinct target", () => {
    const { scheduler, elapse, pendingCount } = createManualScheduler();
    const flush = mock<(props: { target: string }) => void>(() => {});
    const coalescer = createInvalidationCoalescer({
      flush,
      windowMs: 300,
      scheduler,
    });

    coalescer.schedule({ target: "healthcheck" });
    coalescer.schedule({ target: "incident" });
    coalescer.schedule({ target: "maintenance" });

    expect(pendingCount()).toBe(3);

    elapse();

    expect(flush).toHaveBeenCalledTimes(3);
    const targets = flush.mock.calls.map(([{ target }]) => target).sort();
    expect(targets).toEqual(["healthcheck", "incident", "maintenance"]);
  });

  it("flushes again for a schedule after a prior flush", () => {
    const { scheduler, elapse } = createManualScheduler();
    const flush = mock<(props: { target: string }) => void>(() => {});
    const coalescer = createInvalidationCoalescer({
      flush,
      windowMs: 300,
      scheduler,
    });

    coalescer.schedule({ target: "healthcheck" });
    elapse();
    expect(flush).toHaveBeenCalledTimes(1);

    coalescer.schedule({ target: "healthcheck" });
    elapse();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels a pending flush", () => {
    const { scheduler, elapse, pendingCount } = createManualScheduler();
    const flush = mock<(props: { target: string }) => void>(() => {});
    const coalescer = createInvalidationCoalescer({
      flush,
      windowMs: 300,
      scheduler,
    });

    coalescer.schedule({ target: "healthcheck" });
    coalescer.dispose();

    expect(pendingCount()).toBe(0);

    elapse();

    expect(flush).not.toHaveBeenCalled();
  });
});
