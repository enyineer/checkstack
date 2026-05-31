import { describe, expect, it } from "bun:test";

import { createInMemoryWindowStore } from "./test-fixtures";
import type { WindowRefire } from "./types";

const AUTO = "auto-1";
const TRIGGER = "flapping";
const EVENT = "healthcheck.system_health_changed";

function at(baseMs: number, offsetMinutes: number): Date {
  return new Date(baseMs + offsetMinutes * 60_000);
}

function record(opts: {
  store: ReturnType<typeof createInMemoryWindowStore>["store"];
  occurredAt: Date;
  windowMinutes?: number;
  threshold?: number;
  refire?: WindowRefire;
  contextKey?: string | null;
  automationId?: string;
  triggerId?: string;
  eventId?: string;
}): Promise<boolean> {
  return opts.store.recordAndCount({
    automationId: opts.automationId ?? AUTO,
    triggerId: opts.triggerId ?? TRIGGER,
    eventId: opts.eventId ?? EVENT,
    contextKey: opts.contextKey ?? "sys-1",
    occurredAt: opts.occurredAt,
    windowMinutes: opts.windowMinutes ?? 60,
    threshold: opts.threshold ?? 3,
    refire: opts.refire ?? "every",
  });
}

describe("WindowStore.recordAndCount — counting within the window", () => {
  it("counts occurrences within the trailing window (inclusive of the new row)", async () => {
    const { store } = createInMemoryWindowStore();
    const base = Date.now();
    // 3 occurrences inside a 60-minute window; `every` threshold 3.
    expect(await record({ store, occurredAt: at(base, 0) })).toBe(false); // count 1
    expect(await record({ store, occurredAt: at(base, 10) })).toBe(false); // count 2
    expect(await record({ store, occurredAt: at(base, 20) })).toBe(true); // count 3 ⇒ fire
    expect(await record({ store, occurredAt: at(base, 30) })).toBe(true); // count 4, every ⇒ still fires
  });

  it("`once` fires only on the crossing edge", async () => {
    const { store } = createInMemoryWindowStore();
    const base = Date.now();
    expect(
      await record({ store, occurredAt: at(base, 0), refire: "once" }),
    ).toBe(false); // count 1
    expect(
      await record({ store, occurredAt: at(base, 10), refire: "once" }),
    ).toBe(false); // count 2
    expect(
      await record({ store, occurredAt: at(base, 20), refire: "once" }),
    ).toBe(true); // count 3 === threshold ⇒ fire (edge)
    expect(
      await record({ store, occurredAt: at(base, 30), refire: "once" }),
    ).toBe(false); // count 4 > threshold ⇒ suppressed
  });

  it("`once` re-arms as old rows age out and the count re-crosses", async () => {
    const { store } = createInMemoryWindowStore();
    const base = Date.now();
    const w = 10; // 10-minute window
    // First burst: 3 rows at t=0,1,2 inside the 10-min window ⇒ edge at the 3rd.
    await record({ store, occurredAt: at(base, 0), windowMinutes: w, refire: "once" });
    await record({ store, occurredAt: at(base, 1), windowMinutes: w, refire: "once" });
    expect(
      await record({ store, occurredAt: at(base, 2), windowMinutes: w, refire: "once" }),
    ).toBe(true);
    // 4th still inside ⇒ suppressed (count 4 > threshold).
    expect(
      await record({ store, occurredAt: at(base, 3), windowMinutes: w, refire: "once" }),
    ).toBe(false);
    // Second burst much later (t=100..102): the t=0..3 rows are all >10 min
    // old, so the window holds only the new rows. The 3rd new row re-crosses
    // the threshold edge.
    await record({ store, occurredAt: at(base, 100), windowMinutes: w, refire: "once" }); // count 1
    await record({ store, occurredAt: at(base, 101), windowMinutes: w, refire: "once" }); // count 2
    expect(
      await record({ store, occurredAt: at(base, 102), windowMinutes: w, refire: "once" }),
    ).toBe(true); // count 3 ⇒ edge again
  });

  it("slides: occurrences older than the window do not count", async () => {
    const { store } = createInMemoryWindowStore();
    const base = Date.now();
    const w = 10;
    // 2 occurrences at t=0,1; then a gap past the window.
    await record({ store, occurredAt: at(base, 0), windowMinutes: w, threshold: 3 });
    await record({ store, occurredAt: at(base, 1), windowMinutes: w, threshold: 3 });
    // t=20 is >10 min after t=0,1 — those have aged out; count is just 1.
    expect(
      await record({ store, occurredAt: at(base, 20), windowMinutes: w, threshold: 3 }),
    ).toBe(false);
  });
});

describe("WindowStore — key isolation", () => {
  it("counts are independent per (automation, contextKey, eventId)", async () => {
    const { store } = createInMemoryWindowStore();
    const base = Date.now();
    // Same automation+trigger, two systems: each needs its own 3 to fire.
    await record({ store, occurredAt: at(base, 0), contextKey: "sys-1" });
    await record({ store, occurredAt: at(base, 1), contextKey: "sys-1" });
    await record({ store, occurredAt: at(base, 2), contextKey: "sys-2" });
    // sys-1 reaches 3 first.
    expect(
      await record({ store, occurredAt: at(base, 3), contextKey: "sys-1" }),
    ).toBe(true);
    // sys-2 still at 2.
    expect(
      await record({ store, occurredAt: at(base, 4), contextKey: "sys-2" }),
    ).toBe(false);

    // A different automation watching the same event/system has its own count.
    expect(
      await record({
        store,
        occurredAt: at(base, 5),
        contextKey: "sys-1",
        automationId: "auto-2",
      }),
    ).toBe(false); // count 1 for auto-2/sys-1
  });

  it("a null contextKey forms its own per-automation window", async () => {
    const { store } = createInMemoryWindowStore();
    const base = Date.now();
    await record({ store, occurredAt: at(base, 0), contextKey: null });
    await record({ store, occurredAt: at(base, 1), contextKey: null });
    expect(
      await record({ store, occurredAt: at(base, 2), contextKey: null }),
    ).toBe(true);
  });
});

describe("WindowStore — pruning + lifecycle", () => {
  it("sweepExpired deletes only rows older than the cutoff", async () => {
    const { store, events } = createInMemoryWindowStore();
    const base = Date.now();
    await record({ store, occurredAt: at(base, -120) }); // 2h ago
    await record({ store, occurredAt: at(base, 0) }); // now
    await store.sweepExpired(at(base, -60)); // cutoff 1h ago
    expect(events).toHaveLength(1);
    expect(events[0]!.occurredAt.getTime()).toBe(at(base, 0).getTime());
  });

  it("deleteForAutomation drops only that automation's rows", async () => {
    const { store, events } = createInMemoryWindowStore();
    const base = Date.now();
    await record({ store, occurredAt: at(base, 0), automationId: "auto-1" });
    await record({ store, occurredAt: at(base, 1), automationId: "auto-2" });
    await store.deleteForAutomation("auto-1");
    expect(events).toHaveLength(1);
    expect(events[0]!.automationId).toBe("auto-2");
  });
});
