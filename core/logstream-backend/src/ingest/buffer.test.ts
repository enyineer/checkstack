import { describe, it, expect } from "bun:test";
import type { IngestedLine } from "@checkstack/logstream-common";
import { IngestBuffer } from "./buffer";

function line(body: string): IngestedLine {
  return {
    ts: new Date(0),
    observedAt: new Date(0),
    severityNumber: 9,
    band: "info",
    body,
  };
}

function lines(n: number): IngestedLine[] {
  return Array.from({ length: n }, (_, i) => line(`l${i}`));
}

/** A line whose body alone is `bodyLen` chars (drives the byte estimate). */
function fatLines(n: number, bodyLen: number): IngestedLine[] {
  return Array.from({ length: n }, () => line("x".repeat(bodyLen)));
}

describe("IngestBuffer", () => {
  it("accepts up to the global cap and reports overflow", () => {
    const buffer = new IngestBuffer(5);
    const first = buffer.push({ streamId: "s1", lines: lines(3) });
    expect(first).toEqual({ accepted: 3, rejected: 0 });
    const second = buffer.push({ streamId: "s1", lines: lines(4) });
    expect(second.accepted).toBe(2);
    expect(second.rejected).toBe(2);
    expect(buffer.size).toBe(5);
  });

  it("lets a lone stream fill the whole buffer", () => {
    const buffer = new IngestBuffer(10);
    const res = buffer.push({ streamId: "solo", lines: lines(10) });
    expect(res.accepted).toBe(10);
  });

  it("enforces a per-stream fair share under contention", () => {
    const buffer = new IngestBuffer(10);
    // Two streams active -> fair share floor(10/2)=5 each for the second push.
    buffer.push({ streamId: "s1", lines: lines(1) });
    const res = buffer.push({ streamId: "s2", lines: lines(10) });
    expect(res.accepted).toBe(5);
    expect(res.rejected).toBe(5);
  });

  it("drains grouped by stream and resets size + bytes", () => {
    const buffer = new IngestBuffer(100);
    buffer.push({ streamId: "s1", lines: lines(2) });
    buffer.push({ streamId: "s2", lines: lines(3) });
    expect(buffer.byteSize).toBeGreaterThan(0);
    const drained = buffer.drain();
    expect(drained.get("s1")).toHaveLength(2);
    expect(drained.get("s2")).toHaveLength(3);
    expect(buffer.size).toBe(0);
    expect(buffer.byteSize).toBe(0);
    expect(buffer.drain().size).toBe(0);
  });

  it("trips the byte budget before the line cap for fat lines", () => {
    // Line cap 1000 (won't be reached); byte budget 1000. Each fat line is
    // 300 body + 64 overhead = 364 bytes, so only two fit.
    const buffer = new IngestBuffer(1000, 1000);
    const res = buffer.push({ streamId: "s1", lines: fatLines(5, 300) });
    expect(res.accepted).toBe(2);
    expect(res.rejected).toBe(3);
    expect(buffer.size).toBe(2);
    expect(buffer.byteSize).toBe(728);
  });

  it("always admits at least one line even if it alone exceeds the byte budget", () => {
    // A single 300+64=364 byte line into a 100-byte budget: admitted so one fat
    // line can never wedge the buffer, but the next line is refused.
    const buffer = new IngestBuffer(1000, 100);
    const res = buffer.push({ streamId: "s1", lines: fatLines(3, 300) });
    expect(res.accepted).toBe(1);
    expect(res.rejected).toBe(2);
  });

  it("hot-stream-first can fill the cap and starve a later stream until drain", () => {
    // Documented bounded-starvation behavior: fairness is per-push, not a
    // reservation. A stream pushing first while alone fills the global cap; a
    // later stream gets 0 until the next drain clears the buffer.
    const buffer = new IngestBuffer(10);
    const hot = buffer.push({ streamId: "hot", lines: lines(10) });
    expect(hot.accepted).toBe(10);
    const late = buffer.push({ streamId: "late", lines: lines(5) });
    expect(late.accepted).toBe(0);
    expect(late.rejected).toBe(5);
    // After the flush drains, every stream competes fresh.
    buffer.drain();
    const afterDrain = buffer.push({ streamId: "late", lines: lines(5) });
    expect(afterDrain.accepted).toBe(5);
  });
});
