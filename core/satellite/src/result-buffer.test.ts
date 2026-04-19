import { describe, test, expect } from "bun:test";
import { ResultBuffer } from "./result-buffer";
import type { ResultMessage } from "@checkstack/satellite-common";

function makeResult(overrides?: Partial<ResultMessage>): ResultMessage {
  return {
    type: "result",
    configId: "config-1",
    systemId: "system-1",
    status: "healthy",
    latencyMs: 42,
    executedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ResultBuffer", () => {
  test("starts empty", () => {
    const buffer = new ResultBuffer();
    expect(buffer.size).toBe(0);
    expect(buffer.isEmpty).toBe(true);
  });

  test("push adds results", () => {
    const buffer = new ResultBuffer();
    buffer.push(makeResult());
    expect(buffer.size).toBe(1);
    expect(buffer.isEmpty).toBe(false);
  });

  test("flush returns all results and clears buffer", () => {
    const buffer = new ResultBuffer();
    const r1 = makeResult({ configId: "a" });
    const r2 = makeResult({ configId: "b" });
    buffer.push(r1);
    buffer.push(r2);

    const flushed = buffer.flush();
    expect(flushed).toHaveLength(2);
    expect(flushed[0].configId).toBe("a");
    expect(flushed[1].configId).toBe("b");
    expect(buffer.size).toBe(0);
    expect(buffer.isEmpty).toBe(true);
  });

  test("flush returns empty array when buffer is empty", () => {
    const buffer = new ResultBuffer();
    expect(buffer.flush()).toEqual([]);
  });

  test("drops oldest when capacity is exceeded", () => {
    const buffer = new ResultBuffer(3);
    buffer.push(makeResult({ configId: "1" }));
    buffer.push(makeResult({ configId: "2" }));
    buffer.push(makeResult({ configId: "3" }));

    // Buffer is full, next push should drop "1"
    buffer.push(makeResult({ configId: "4" }));
    expect(buffer.size).toBe(3);

    const flushed = buffer.flush();
    expect(flushed.map((r) => r.configId)).toEqual(["2", "3", "4"]);
  });

  test("respects custom capacity", () => {
    const buffer = new ResultBuffer(1);
    buffer.push(makeResult({ configId: "first" }));
    buffer.push(makeResult({ configId: "second" }));

    expect(buffer.size).toBe(1);
    const flushed = buffer.flush();
    expect(flushed[0].configId).toBe("second");
  });
});
