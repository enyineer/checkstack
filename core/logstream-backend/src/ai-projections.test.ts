import { describe, it, expect } from "bun:test";
import { projectLogEventsForModel, type LeanLogEvent } from "./ai-projections";

const fullEvent = (over: Record<string, unknown> = {}) => ({
  id: "42",
  streamId: "stream-1",
  ts: new Date("2026-07-14T10:00:00.000Z"),
  observedAt: new Date("2026-07-14T10:00:01.000Z"),
  severityNumber: 17,
  severityText: "ERROR",
  band: "error" as const,
  body: "boom",
  attributes: { "http.method": "GET", big: "x".repeat(5000) },
  resource: { "service.name": "checkout-api" },
  patternId: "pat-1",
  traceId: "trace-1",
  spanId: "span-1",
  ...over,
});

describe("projectLogEventsForModel", () => {
  it("drops attributes/resource and opaque ids, keeps time/band/body + handles", () => {
    const out = projectLogEventsForModel({
      events: [fullEvent()],
      nextCursor: { ts: new Date(), id: "42" },
    }) as { events: LeanLogEvent[]; returned: number };

    expect(out.returned).toBe(1);
    const e = out.events[0]!;
    expect(e).toEqual({
      ts: "2026-07-14T10:00:00.000Z",
      band: "error",
      severityText: "ERROR",
      body: "boom",
      patternId: "pat-1",
      traceId: "trace-1",
    });
    // The heavy / opaque fields never reach the model.
    expect(e).not.toHaveProperty("attributes");
    expect(e).not.toHaveProperty("resource");
    expect(e).not.toHaveProperty("id");
    expect(e).not.toHaveProperty("streamId");
    expect(e).not.toHaveProperty("spanId");
    // The opaque cursor is dropped too.
    expect(out).not.toHaveProperty("nextCursor");
  });

  it("clamps a long body to 300 chars and flags truncation", () => {
    const out = projectLogEventsForModel({
      events: [fullEvent({ body: "a".repeat(1000) })],
    }) as { events: LeanLogEvent[] };
    const e = out.events[0]!;
    expect(e.body).toHaveLength(300);
    expect(e.truncated).toBe(true);
  });

  it("omits optional handles when absent and does not flag a short body", () => {
    const out = projectLogEventsForModel({
      events: [
        fullEvent({ patternId: null, traceId: null, severityText: null, body: "ok" }),
      ],
    }) as { events: LeanLogEvent[] };
    const e = out.events[0]!;
    expect(e.body).toBe("ok");
    expect(e).not.toHaveProperty("truncated");
    expect(e).not.toHaveProperty("patternId");
    expect(e).not.toHaveProperty("traceId");
    expect(e).not.toHaveProperty("severityText");
  });

  it("accepts an ISO-string ts (transport-serialized output)", () => {
    const out = projectLogEventsForModel({
      events: [fullEvent({ ts: "2026-07-14T10:00:00.000Z" })],
    }) as { events: LeanLogEvent[] };
    expect(out.events[0]!.ts).toBe("2026-07-14T10:00:00.000Z");
  });

  it("returns the output unchanged when the shape does not match (defensive)", () => {
    const weird = { totallyDifferent: true };
    expect(projectLogEventsForModel(weird)).toBe(weird);
  });
});
