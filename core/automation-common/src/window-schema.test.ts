import { describe, expect, it } from "bun:test";

import { TriggerSchema, WindowSchema } from "./schemas";

describe("WindowSchema", () => {
  it("parses a full window block", () => {
    const parsed = WindowSchema.parse({
      count: 3,
      minutes: 60,
      refire: "once",
    });
    expect(parsed).toEqual({ count: 3, minutes: 60, refire: "once" });
  });

  it("defaults refire to `every` when omitted", () => {
    const parsed = WindowSchema.parse({ count: 5, minutes: 10 });
    expect(parsed.refire).toBe("every");
  });

  it("rejects count below 1", () => {
    expect(() => WindowSchema.parse({ count: 0, minutes: 10 })).toThrow();
  });

  it("rejects count above 1000", () => {
    expect(() => WindowSchema.parse({ count: 1001, minutes: 10 })).toThrow();
  });

  it("rejects minutes above 1440 (the 24h cap)", () => {
    expect(() => WindowSchema.parse({ count: 3, minutes: 1441 })).toThrow();
  });

  it("rejects a non-integer count", () => {
    expect(() => WindowSchema.parse({ count: 2.5, minutes: 10 })).toThrow();
  });

  it("rejects an unknown refire mode", () => {
    expect(() =>
      WindowSchema.parse({ count: 3, minutes: 10, refire: "cooldown" }),
    ).toThrow();
  });

  it("leaves partitionBy undefined when omitted", () => {
    const parsed = WindowSchema.parse({ count: 3, minutes: 60 });
    expect(parsed.partitionBy).toBeUndefined();
  });

  it("parses a partitionBy bare expression and trims surrounding whitespace", () => {
    const parsed = WindowSchema.parse({
      count: 3,
      minutes: 60,
      partitionBy: "  trigger.payload.severity  ",
    });
    expect(parsed.partitionBy).toBe("trigger.payload.severity");
  });

  it("rejects an empty / whitespace-only partitionBy", () => {
    expect(() =>
      WindowSchema.parse({ count: 3, minutes: 60, partitionBy: "   " }),
    ).toThrow();
  });
});

describe("TriggerSchema window field", () => {
  it("accepts a trigger without a window (window optional)", () => {
    const parsed = TriggerSchema.parse({
      event: "healthcheck.system_health_changed",
    });
    expect(parsed.window).toBeUndefined();
  });

  it("accepts a trigger carrying a window + filter (flapping shape)", () => {
    const parsed = TriggerSchema.parse({
      id: "flapping",
      event: "healthcheck.system_health_changed",
      filter: '{{ trigger.payload.newStatus != "healthy" }}',
      window: { count: 3, minutes: 60, refire: "once" },
    });
    expect(parsed.window).toEqual({ count: 3, minutes: 60, refire: "once" });
    expect(parsed.filter).toBe('{{ trigger.payload.newStatus != "healthy" }}');
  });

  it("applies the refire default inside a trigger window", () => {
    const parsed = TriggerSchema.parse({
      event: "healthcheck.check_failed",
      window: { count: 5, minutes: 10 },
    });
    expect(parsed.window?.refire).toBe("every");
  });
});
