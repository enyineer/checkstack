import { describe, it, expect } from "bun:test";
import { DEFAULT_LOG_STREAM_CONFIG } from "../../schemas";
import { parseNativeBody } from "./native";

const config = DEFAULT_LOG_STREAM_CONFIG;
const now = new Date("2026-07-12T12:00:00.000Z");

describe("parseNativeBody - NDJSON", () => {
  it("parses one object per line, mapping fields and collecting attributes", () => {
    const text = [
      '{"ts":"2026-07-12T10:00:00Z","level":"error","message":"db down","service":"api"}',
      '{"level":"info","body":"ok","count":5}',
      "", // blank line ignored
    ].join("\n");

    const { lines, rejected } = parseNativeBody({
      text,
      ndjson: true,
      config,
      now,
    });

    expect(rejected).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.band).toBe("error");
    expect(lines[0]!.body).toBe("db down");
    expect(lines[0]!.ts.toISOString()).toBe("2026-07-12T10:00:00.000Z");
    expect(lines[0]!.attributes).toEqual({ service: "api" });
    expect(lines[1]!.band).toBe("info");
    expect(lines[1]!.ts).toEqual(now); // default when ts omitted
    expect(lines[1]!.attributes).toEqual({ count: 5 });
  });

  it("counts malformed lines as rejected without failing the batch", () => {
    const text = '{"message":"good"}\nnot json\n{"message":"also good"}';
    const { lines, rejected } = parseNativeBody({
      text,
      ndjson: true,
      config,
      now,
    });
    expect(lines).toHaveLength(2);
    expect(rejected).toBe(1);
  });
});

describe("parseNativeBody - JSON", () => {
  it("accepts a bare array", () => {
    const text = JSON.stringify([
      { level: "warn", message: "a" },
      { severity: 17, message: "b" },
    ]);
    const { lines } = parseNativeBody({ text, ndjson: false, config, now });
    expect(lines.map((l) => l.band)).toEqual(["warn", "error"]);
  });

  it("accepts a { logs: [...] } envelope", () => {
    const text = JSON.stringify({ logs: [{ message: "hi" }] });
    const { lines } = parseNativeBody({ text, ndjson: false, config, now });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.body).toBe("hi");
  });

  it("accepts a single object with an epoch-millis ts", () => {
    // An epoch within the clamp trust window (2h before `now`), parsed as-is.
    const epochMs = Date.parse("2026-07-12T10:00:00.000Z");
    const text = JSON.stringify({ level: "debug", message: "x", ts: epochMs });
    const { lines } = parseNativeBody({ text, ndjson: false, config, now });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.band).toBe("debug");
    expect(lines[0]!.ts.getTime()).toBe(epochMs);
  });

  it("clamps an epoch-millis ts that is far in the past", () => {
    // A year before `now` -> beyond MAX_PAST_LAG_MS -> snapped to now - 24h.
    const ancient = Date.parse("2025-07-12T10:00:00.000Z");
    const text = JSON.stringify({ level: "debug", message: "x", ts: ancient });
    const { lines } = parseNativeBody({ text, ndjson: false, config, now });
    expect(lines[0]!.ts.getTime()).toBe(now.getTime() - 24 * 60 * 60_000);
  });

  it("rejects an unparseable JSON body", () => {
    const { lines, rejected } = parseNativeBody({
      text: "{bad",
      ndjson: false,
      config,
      now,
    });
    expect(lines).toHaveLength(0);
    expect(rejected).toBe(1);
  });

  it("lifts traceId / spanId / resource out of attributes", () => {
    const text = JSON.stringify({
      message: "m",
      traceId: "abc",
      spanId: "def",
      resource: { "service.name": "svc" },
      extra: 1,
    });
    const { lines } = parseNativeBody({ text, ndjson: false, config, now });
    expect(lines[0]!.traceId).toBe("abc");
    expect(lines[0]!.spanId).toBe("def");
    expect(lines[0]!.resource).toEqual({ "service.name": "svc" });
    expect(lines[0]!.attributes).toEqual({ extra: 1 });
  });
});

describe("parseNativeBody - severityRules.valueMap", () => {
  it("re-bands a line by the raw level, case-insensitively, over the default", () => {
    // "warning" defaults to `warn`; the stream maps it to `error`.
    const text = '{"level":"warning","message":"disk pressure"}';
    const { lines } = parseNativeBody({
      text,
      ndjson: true,
      now,
      config: {
        ...config,
        severityRules: { valueMap: { WARNING: "error" } },
      },
    });
    expect(lines[0]!.band).toBe("error");
    // The stored severityText/number still reflect the SOURCE, not the override.
    expect(lines[0]!.severityText).toBe("warning");
  });
});
