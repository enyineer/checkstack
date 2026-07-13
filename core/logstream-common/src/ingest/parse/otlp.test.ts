import { describe, it, expect } from "bun:test";
import { DEFAULT_LOG_STREAM_CONFIG } from "../../schemas";
import { normalizeOtlpPayload, parseOtlpJson } from "./otlp";
import { decodeExportLogsServiceRequest } from "../protobuf/otlp";
import { encodeExportLogsServiceRequest } from "../protobuf/otlp-encode";

const config = DEFAULT_LOG_STREAM_CONFIG;
const now = new Date("2026-07-12T12:00:00.000Z");
// 2026-07-12T10:00:00Z in nanoseconds since the epoch.
const eventNanos = BigInt(Date.parse("2026-07-12T10:00:00.000Z")) * 1_000_000n;

describe("OTLP protobuf round-trip -> normalized lines", () => {
  it("decodes an encoded ExportLogsServiceRequest into normalized lines", () => {
    const bytes = encodeExportLogsServiceRequest([
      {
        resource: { "service.name": { stringValue: "api" } },
        records: [
          {
            timeUnixNano: eventNanos,
            severityNumber: 17,
            severityText: "ERROR",
            body: { stringValue: "boom happened" },
            attributes: {
              "http.method": { stringValue: "GET" },
              retries: { intValue: 3 },
            },
            traceId: "0af7651916cd43dd8448eb211c80319c",
            spanId: "b7ad6b7169203331",
          },
        ],
      },
    ]);

    const payload = decodeExportLogsServiceRequest(bytes);
    const { lines, rejected } = normalizeOtlpPayload({ payload, config, now });

    expect(rejected).toBe(0);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.band).toBe("error");
    expect(line.severityNumber).toBe(17);
    expect(line.body).toBe("boom happened");
    expect(line.ts.toISOString()).toBe("2026-07-12T10:00:00.000Z");
    expect(line.observedAt).toBe(now);
    expect(line.attributes).toEqual({ "http.method": "GET", retries: 3 });
    expect(line.resource).toEqual({ "service.name": "api" });
    expect(line.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(line.spanId).toBe("b7ad6b7169203331");
  });

  it("falls back to observed time then now when event time is absent", () => {
    const observedNanos = BigInt(Date.parse("2026-07-12T09:00:00Z")) * 1_000_000n;
    const bytes = encodeExportLogsServiceRequest([
      {
        records: [
          { observedTimeUnixNano: observedNanos, body: { stringValue: "a" } },
          { body: { stringValue: "b" } },
        ],
      },
    ]);
    const { lines } = normalizeOtlpPayload({
      payload: decodeExportLogsServiceRequest(bytes),
      config,
      now,
    });
    expect(lines[0]!.ts.toISOString()).toBe("2026-07-12T09:00:00.000Z");
    expect(lines[1]!.ts).toEqual(now);
    // No severity -> info band, number 0.
    expect(lines[0]!.band).toBe("info");
  });
});

describe("parseOtlpJson -> normalized lines", () => {
  it("parses the proto-JSON shape (camelCase, string int64, enum severity)", () => {
    const json = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "web" } },
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: String(eventNanos),
                  severityNumber: "SEVERITY_NUMBER_WARN",
                  body: { stringValue: "slow response" },
                  attributes: [
                    { key: "latency_ms", value: { intValue: "1200" } },
                  ],
                  traceId: "0af7651916cd43dd8448eb211c80319c",
                },
              ],
            },
          ],
        },
      ],
    };

    const { lines, rejected } = normalizeOtlpPayload({
      payload: parseOtlpJson(json),
      config,
      now,
    });

    expect(rejected).toBe(0);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.band).toBe("warn");
    expect(line.body).toBe("slow response");
    expect(line.attributes).toEqual({ latency_ms: 1200 });
    expect(line.resource).toEqual({ "service.name": "web" });
    expect(line.ts.toISOString()).toBe("2026-07-12T10:00:00.000Z");
  });

  it("returns an empty payload for a non-OTLP body", () => {
    expect(parseOtlpJson({ nonsense: true })).toEqual([]);
    expect(parseOtlpJson("nope")).toEqual([]);
  });

  it("rejects a content-less record and counts it toward partialSuccess", () => {
    // One usable record plus one with no body AND no attributes: the empty one
    // is the ONLY thing normalization rejects, driving rejectedLogRecords.
    const json = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                { body: { stringValue: "real line" } },
                {}, // no body, no attributes -> rejected
              ],
            },
          ],
        },
      ],
    };
    const { lines, rejected, clamped } = normalizeOtlpPayload({
      payload: parseOtlpJson(json),
      config,
      now,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.body).toBe("real line");
    expect(rejected).toBe(1);
    expect(clamped).toBe(0);
  });

  it("keeps a record that has attributes but no body", () => {
    const json = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                { attributes: [{ key: "event", value: { stringValue: "login" } }] },
              ],
            },
          ],
        },
      ],
    };
    const { lines, rejected } = normalizeOtlpPayload({
      payload: parseOtlpJson(json),
      config,
      now,
    });
    expect(rejected).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.body).toBe("");
    expect(lines[0]!.attributes).toEqual({ event: "login" });
  });

  it("clamps a far-future client timestamp to the future-skew bound and counts it", () => {
    const futureNanos =
      BigInt(now.getTime() + 365 * 24 * 60 * 60_000) * 1_000_000n;
    const json = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: String(futureNanos),
                  body: { stringValue: "from the future" },
                },
              ],
            },
          ],
        },
      ],
    };
    const { lines, clamped } = normalizeOtlpPayload({
      payload: parseOtlpJson(json),
      config,
      now,
    });
    expect(clamped).toBe(1);
    // Snapped to now + 2min (MAX_FUTURE_SKEW_MS), never a year ahead.
    expect(lines[0]!.ts.getTime()).toBe(now.getTime() + 2 * 60_000);
  });
});

describe("severityRules.valueMap (OTLP severityText)", () => {
  it("re-bands by the raw severityText, case-insensitively, over the default", () => {
    const payload = parseOtlpJson({
      resourceLogs: [
        {
          resource: {},
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: String(eventNanos),
                  severityText: "Warn",
                  body: { stringValue: "cache degraded" },
                },
              ],
            },
          ],
        },
      ],
    });
    const { lines } = normalizeOtlpPayload({
      payload,
      now,
      config: { ...config, severityRules: { valueMap: { warn: "error" } } },
    });
    expect(lines[0]!.band).toBe("error");
    expect(lines[0]!.severityText).toBe("Warn");
  });
});
