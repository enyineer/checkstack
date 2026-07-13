import { describe, it, expect } from "bun:test";
import {
  LogStreamConfigSchema,
  DEFAULT_LOG_STREAM_CONFIG,
  SearchEventsSchema,
  ListImportantEventsSchema,
  CreateLogStreamSchema,
  CreatePatternSchema,
  TestPatternSchema,
  SeverityRulesSchema,
  MAX_LOG_LINE_CHARS,
  MAX_SEVERITY_VALUE_MAP_ENTRIES,
  MAX_SEVERITY_PATTERN_OVERRIDES,
} from "./schemas";

describe("LogStreamConfigSchema defaults", () => {
  it("fills every field from an empty object", () => {
    expect(LogStreamConfigSchema.parse({})).toEqual({
      rawRetentionDays: 3,
      minuteRetentionHours: 48,
      hourlyRetentionDays: 90,
      infoSampleRate: 0.05,
      maxRawPerMinute: 600,
      maxLineBytes: 32_768,
      softRateLimitPerMinute: 60_000,
    });
  });

  it("DEFAULT_LOG_STREAM_CONFIG equals the parsed empty config", () => {
    expect(DEFAULT_LOG_STREAM_CONFIG).toEqual(LogStreamConfigSchema.parse({}));
  });

  it("overrides only the provided fields", () => {
    const parsed = LogStreamConfigSchema.parse({ infoSampleRate: 0.5 });
    expect(parsed.infoSampleRate).toBe(0.5);
    expect(parsed.rawRetentionDays).toBe(3);
  });

  it("rejects out-of-range sample rate", () => {
    expect(() => LogStreamConfigSchema.parse({ infoSampleRate: 2 })).toThrow();
  });
});

describe("SearchEventsSchema", () => {
  it("defaults limit to 100", () => {
    const parsed = SearchEventsSchema.parse({ streamId: "s" });
    expect(parsed.limit).toBe(100);
  });

  it("coerces from/to dates and caps limit at 200", () => {
    const parsed = SearchEventsSchema.parse({
      streamId: "s",
      from: "2026-01-01T00:00:00Z",
      limit: 200,
    });
    expect(parsed.from).toBeInstanceOf(Date);
    expect(() =>
      SearchEventsSchema.parse({ streamId: "s", limit: 500 }),
    ).toThrow();
  });
});

describe("ListImportantEventsSchema", () => {
  it("defaults limit to 50", () => {
    expect(ListImportantEventsSchema.parse({ streamId: "s" }).limit).toBe(50);
  });
});

describe("CreateLogStreamSchema", () => {
  it("requires a non-empty name", () => {
    expect(() => CreateLogStreamSchema.parse({ name: "" })).toThrow();
    expect(CreateLogStreamSchema.parse({ name: "prod-logs" }).name).toBe(
      "prod-logs",
    );
  });
});

describe("pattern template bounds", () => {
  it("accepts a template at the char cap and rejects one over it", () => {
    const atCap = "a".repeat(MAX_LOG_LINE_CHARS);
    expect(
      CreatePatternSchema.parse({ streamId: "s", template: atCap }).template,
    ).toBe(atCap);
    expect(() =>
      CreatePatternSchema.parse({
        streamId: "s",
        template: "a".repeat(MAX_LOG_LINE_CHARS + 1),
      }),
    ).toThrow();
    expect(() =>
      TestPatternSchema.parse({
        streamId: "s",
        template: "a".repeat(MAX_LOG_LINE_CHARS + 1),
      }),
    ).toThrow();
  });
});

describe("SeverityRulesSchema bounds", () => {
  it("accepts a valueMap at the entry cap and rejects one over it", () => {
    const atCap = Object.fromEntries(
      Array.from({ length: MAX_SEVERITY_VALUE_MAP_ENTRIES }, (_, i) => [
        `lvl${i}`,
        "warn" as const,
      ]),
    );
    expect(() => SeverityRulesSchema.parse({ valueMap: atCap })).not.toThrow();

    const overCap = {
      ...atCap,
      [`lvl${MAX_SEVERITY_VALUE_MAP_ENTRIES}`]: "warn" as const,
    };
    expect(() => SeverityRulesSchema.parse({ valueMap: overCap })).toThrow(
      /at most/i,
    );
  });

  it("rejects more than the max patternOverrides", () => {
    const overrides = Array.from(
      { length: MAX_SEVERITY_PATTERN_OVERRIDES + 1 },
      (_, i) => ({ patternId: `p${i}`, band: "error" as const }),
    );
    expect(() => SeverityRulesSchema.parse({ patternOverrides: overrides })).toThrow();
  });
});
