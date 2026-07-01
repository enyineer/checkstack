import { describe, expect, it } from "bun:test";
import { createFakeSupervisor } from "../dev-tui/fake-supervisor.ts";
import { createProcessStore } from "./process-store.ts";

describe("createProcessStore", () => {
  it("accumulates per-process scrollback and statuses, notifies subscribers", () => {
    const fake = createFakeSupervisor();
    const store = createProcessStore(fake);
    let notified = 0;
    store.subscribe(() => notified++);

    fake.emitStatus({ id: "backend", status: "ready" });
    fake.emitLine({ source: "backend", level: "info", text: "hello", seq: 1 });

    expect(store.getSnapshot().statuses.backend).toBe("ready");
    expect(
      store.windowFor({ id: "backend", height: 10, scrollOffset: 0 }).map((l) => l.text),
    ).toEqual(["hello"]);
    expect(notified).toBe(2);
  });

  it("routes lines to the correct process's scrollback", () => {
    const fake = createFakeSupervisor();
    const store = createProcessStore(fake);
    fake.emitLine({ source: "backend", level: "info", text: "b1", seq: 1 });
    fake.emitLine({ source: "frontend", level: "info", text: "f1", seq: 2 });
    expect(
      store.windowFor({ id: "backend", height: 10, scrollOffset: 0 }).map((l) => l.text),
    ).toEqual(["b1"]);
    expect(
      store.windowFor({ id: "frontend", height: 10, scrollOffset: 0 }).map((l) => l.text),
    ).toEqual(["f1"]);
  });

  it("collects warn/error lines into the pinned alerts (newest-first) and counts them", () => {
    const fake = createFakeSupervisor();
    const store = createProcessStore(fake);
    fake.emitLine({ source: "backend", level: "info", text: "ok", seq: 1 });
    fake.emitLine({ source: "backend", level: "error", text: "boom", seq: 2 });
    fake.emitLine({ source: "frontend", level: "warn", text: "careful", seq: 3 });

    const snap = store.getSnapshot();
    expect(snap.alerts.map((a) => a.text)).toEqual(["careful", "boom"]);
    expect(snap.alertCounts.backend).toBe(1);
    expect(snap.alertCounts.frontend).toBe(1);
  });

  it("start() is idempotent", () => {
    const fake = createFakeSupervisor();
    const store = createProcessStore(fake);
    store.start();
    store.start();
    expect(fake.started).toBe(true);
  });

  it("produces a fresh snapshot reference on change and unsubscribe stops notifications", () => {
    const fake = createFakeSupervisor();
    const store = createProcessStore(fake);
    const before = store.getSnapshot();
    fake.emitLine({ source: "deps", level: "info", text: "x", seq: 1 });
    expect(store.getSnapshot()).not.toBe(before);

    let notified = 0;
    const unsub = store.subscribe(() => notified++);
    unsub();
    fake.emitLine({ source: "deps", level: "info", text: "y", seq: 2 });
    expect(notified).toBe(0);
  });
});
