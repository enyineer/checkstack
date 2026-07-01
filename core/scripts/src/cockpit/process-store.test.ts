import { describe, expect, it } from "bun:test";
import { createFakeSupervisor } from "../dev-tui/fake-supervisor.ts";
import { createProcessStore } from "./process-store.ts";

describe("createProcessStore", () => {
  it("accumulates lines and statuses and notifies subscribers", () => {
    const fake = createFakeSupervisor();
    const store = createProcessStore(fake);
    let notified = 0;
    store.subscribe(() => notified++);

    fake.emitStatus({ id: "backend", status: "ready" });
    fake.emitLine({ source: "backend", level: "info", text: "hello", seq: 1 });

    const snap = store.getSnapshot();
    expect(snap.statuses.backend).toBe("ready");
    expect(snap.lines.map((l) => l.text)).toEqual(["hello"]);
    expect(notified).toBe(2);
  });

  it("start() is idempotent", () => {
    const fake = createFakeSupervisor();
    const store = createProcessStore(fake);
    store.start();
    store.start();
    expect(fake.started).toBe(true);
  });

  it("produces a fresh snapshot reference on change (for React equality)", () => {
    const fake = createFakeSupervisor();
    const store = createProcessStore(fake);
    const before = store.getSnapshot();
    fake.emitLine({ source: "deps", level: "info", text: "x", seq: 1 });
    expect(store.getSnapshot()).not.toBe(before);
  });

  it("unsubscribe stops notifications", () => {
    const fake = createFakeSupervisor();
    const store = createProcessStore(fake);
    let notified = 0;
    const unsub = store.subscribe(() => notified++);
    unsub();
    fake.emitLine({ source: "deps", level: "info", text: "x", seq: 1 });
    expect(notified).toBe(0);
  });
});
