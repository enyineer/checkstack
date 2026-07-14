import { describe, it, expect } from "bun:test";
import type { NormalizedSpan } from "@checkstack/telemetry-common";
import { prepareSpan } from "./prepare";

const OBS = new Date("2026-07-14T12:00:00.000Z");

function span(over: Partial<NormalizedSpan>): NormalizedSpan {
  return {
    traceId: "5b8aa5a2d2c872e8321cf37308d69df2",
    spanId: "051581bf3cb55c13",
    name: "op",
    kind: "server",
    startTs: new Date(OBS.getTime() - 100),
    endTs: new Date(OBS.getTime() - 50),
    ...over,
  };
}

describe("prepareSpan", () => {
  it("breaks out serviceName + resource attrs and derives root/error/bucket", () => {
    const { prepared } = prepareSpan({
      span: span({
        parentSpanId: undefined,
        status: { code: "error", message: "x" },
        resource: { serviceName: "api", attributes: { "host.name": "p1" } },
      }),
      observedAt: OBS,
      maxSpanBytes: 32_768,
    });
    expect(prepared.serviceName).toBe("api");
    expect(prepared.resourceAttributes).toEqual({ "host.name": "p1" });
    expect(prepared.isRoot).toBe(true);
    expect(prepared.isError).toBe(true);
    expect(prepared.statusCode).toBe("error");
    expect(prepared.durationMs).toBe(50);
    expect(prepared.bucketStart.getTime() % 60_000).toBe(0);
  });

  it("clamps an ancient start forward (untrusted timestamp)", () => {
    const { prepared } = prepareSpan({
      span: span({ startTs: new Date(0), endTs: new Date(10) }),
      observedAt: OBS,
      maxSpanBytes: 32_768,
    });
    // Snapped to the 24h past bound, not left at 1970.
    expect(prepared.startTs.getTime()).toBeGreaterThan(OBS.getTime() - 25 * 60 * 60_000);
  });

  it("drops oversized attribute payloads to honor maxSpanBytes", () => {
    const big = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`k${i}`, "x".repeat(50)]),
    );
    const { prepared, payloadDropped } = prepareSpan({
      span: span({ attributes: big }),
      observedAt: OBS,
      maxSpanBytes: 256,
    });
    expect(payloadDropped).toBe(true);
    expect(prepared.attributes).toBeNull();
  });

  it("keeps in-budget payloads", () => {
    const { prepared, payloadDropped } = prepareSpan({
      span: span({ attributes: { a: 1 } }),
      observedAt: OBS,
      maxSpanBytes: 32_768,
    });
    expect(payloadDropped).toBe(false);
    expect(prepared.attributes).toEqual({ a: 1 });
  });

  it("defaults status to unset and treats a parented span as non-root", () => {
    const { prepared } = prepareSpan({
      span: span({ parentSpanId: "eee19b7ec3c1b174" }),
      observedAt: OBS,
      maxSpanBytes: 32_768,
    });
    expect(prepared.statusCode).toBe("unset");
    expect(prepared.isError).toBe(false);
    expect(prepared.isRoot).toBe(false);
    expect(prepared.parentSpanId).toBe("eee19b7ec3c1b174");
  });
});
