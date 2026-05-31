import { describe, it, expect } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import type { EntityChanged } from "@checkstack/automation-common";

import { createChangeEmitter } from "./change-emitter";

function makeEvent(id: string): EntityChanged {
  return {
    kind: "incident",
    id,
    prev: null,
    next: { status: "open" },
    delta: { status: "open" },
    changedFields: ["status"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
  };
}

describe("change emitter — deferred wiring window", () => {
  it("buffers events emitted before the emitter is wired, then flushes in order", async () => {
    const emitter = createChangeEmitter();
    expect(emitter.isWired).toBe(false);
    await emitter.emit(makeEvent("a"));
    await emitter.emit(makeEvent("b"));

    const received: string[] = [];
    await emitter.wire(async (p) => {
      received.push(p.id);
    });
    expect(emitter.isWired).toBe(true);
    expect(received).toEqual(["a", "b"]);
  });

  it("emits synchronously once wired", async () => {
    const received: string[] = [];
    const emitter = createChangeEmitter();
    await emitter.wire(async (p) => {
      received.push(p.id);
    });
    await emitter.emit(makeEvent("c"));
    expect(received).toEqual(["c"]);
  });

  it("drops the oldest when the buffer limit is exceeded (guarded, logged)", async () => {
    const warnings: string[] = [];
    const emitter = createChangeEmitter({
      bufferLimit: 2,
      logger: {
        debug: () => {},
        info: () => {},
        warn: (m: string) => warnings.push(m),
        error: () => {},
      } as never,
    });
    await emitter.emit(makeEvent("1"));
    await emitter.emit(makeEvent("2"));
    await emitter.emit(makeEvent("3")); // evicts "1"
    const received: string[] = [];
    await emitter.wire(async (p) => {
      received.push(p.id);
    });
    expect(received).toEqual(["2", "3"]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
