import { describe, it, expect } from "bun:test";
import type { NormalizedLogRecord } from "@checkstack/telemetry-common";
import { DEFAULT_LOG_STREAM_CONFIG, type LogStreamConfig } from "../../schemas";
import {
  applySeverityValueMap,
  capAttributes,
  clampEventTimestamp,
  resolveSeverity,
  truncateBody,
} from "../normalize";
import {
  parseSyslog5424,
  syslogToIngestedLine,
  syslogToNormalizedLogRecord,
} from "./syslog";

const config = DEFAULT_LOG_STREAM_CONFIG;
const now = new Date("2026-07-12T12:00:00.000Z");

/**
 * Reference re-implementation of the logstream SINK's inbound normalization
 * (`createLogstreamTelemetrySink`'s private `toIngestedLine`), built from the
 * SAME public helpers the real sink uses. The parity test feeds a
 * `NormalizedLogRecord` through this to prove the new SOURCE path (parse ->
 * normalized record -> sink) stores the identical line the old direct-to-
 * pipeline `syslogToIngestedLine` produced. Kept in the test (not imported) so a
 * cross-package leak is not needed; the real sink is covered by its own test.
 */
function referenceSinkLine({
  record,
  streamConfig,
  observedAt,
}: {
  record: NormalizedLogRecord;
  streamConfig: LogStreamConfig;
  observedAt: Date;
}) {
  const severity = resolveSeverity({
    severityNumber: record.severityNumber,
    level: record.severityText,
  });
  const band = applySeverityValueMap({
    band: severity.band,
    rawValue: record.severityText,
    valueMap: streamConfig.severityRules?.valueMap,
  });
  const body = truncateBody({
    body: record.body,
    maxBytes: streamConfig.maxLineBytes,
  });
  const attributes = capAttributes({ attributes: record.attributes });
  const { ts } = clampEventTimestamp({ ts: record.ts, observedAt });
  return { ts, severityNumber: severity.severityNumber, band, body, attributes };
}

describe("parseSyslog5424", () => {
  it("parses a full RFC 5424 line with SD token and maps PRI to a band", () => {
    // PRI 11 = facility 1, severity 3 (error).
    const raw =
      '<11>1 2026-07-12T10:00:00.000Z host app 4711 ID1 ' +
      '[checkstack@50501 token="ckls_abc_secret"] disk failure';
    const parsed = parseSyslog5424(raw)!;

    expect(parsed).not.toBeNull();
    expect(parsed.pri).toBe(11);
    expect(parsed.band).toBe("error");
    expect(parsed.ts?.toISOString()).toBe("2026-07-12T10:00:00.000Z");
    expect(parsed.hostname).toBe("host");
    expect(parsed.appName).toBe("app");
    expect(parsed.token).toBe("ckls_abc_secret");
    expect(parsed.message).toBe("disk failure");
  });

  it("resolves the token from a @ckls_...@ MSG prefix and strips it", () => {
    const raw = "<14>1 - host - - - - @ckls_xyz_secret@ hello world";
    const parsed = parseSyslog5424(raw)!;
    expect(parsed.token).toBe("ckls_xyz_secret");
    expect(parsed.message).toBe("hello world");
    expect(parsed.band).toBe("info"); // severity 6
    expect(parsed.ts).toBeNull(); // nil timestamp
  });

  it("returns token null when none is present", () => {
    const raw = "<12>1 - host - - - - no token here"; // severity 4 -> warn
    const parsed = parseSyslog5424(raw)!;
    expect(parsed.token).toBeNull();
    expect(parsed.band).toBe("warn");
  });

  it("returns null for a line with no PRI", () => {
    expect(parseSyslog5424("not a syslog line")).toBeNull();
  });

  it("handles multiple SD elements and non-checkstack params become attributes", () => {
    const raw =
      '<11>1 2026-07-12T10:00:00Z h a p m ' +
      '[exampleSDID@32473 iut="3" eventID="1011"][checkstack@50501 token="ckls_t"] msg';
    const parsed = parseSyslog5424(raw)!;
    expect(parsed.token).toBe("ckls_t");
    const line = syslogToIngestedLine({ parsed, config, now });
    expect(line.attributes?.["sd.exampleSDID@32473.iut"]).toBe("3");
    expect(line.attributes?.["sd.exampleSDID@32473.eventID"]).toBe("1011");
    // The checkstack SD element is not leaked into attributes.
    expect(
      Object.keys(line.attributes ?? {}).some((k) => k.includes("checkstack")),
    ).toBe(false);
  });
});

describe("syslogToIngestedLine", () => {
  it("defaults ts to now when the syslog timestamp was nil", () => {
    const parsed = parseSyslog5424("<14>1 - - - - - - hi")!;
    const line = syslogToIngestedLine({ parsed, config, now });
    expect(line.ts).toEqual(now);
    expect(line.band).toBe("info");
  });

  it("applies severityRules.valueMap keyed on the PRI-derived severity keyword", () => {
    // PRI 11 -> severity 3 -> keyword "err" -> default band "error".
    const parsed = parseSyslog5424("<11>1 - - - - - - disk failure")!;
    expect(parsed.band).toBe("error");
    const remapped = syslogToIngestedLine({
      parsed,
      config: {
        ...config,
        // A stream that treats its syslog errors as fatal, keyed on the keyword.
        severityRules: { valueMap: { err: "fatal" } },
      },
      now,
    });
    expect(remapped.band).toBe("fatal");
    // The stored severityNumber is untouched (only the band is remapped).
    expect(remapped.severityNumber).toBe(parsed.severityNumber);
  });

  it("matches the valueMap keyword case-insensitively", () => {
    // PRI 12 -> severity 4 -> keyword "warning".
    const parsed = parseSyslog5424("<12>1 - - - - - - heads up")!;
    expect(parsed.band).toBe("warn");
    const line = syslogToIngestedLine({
      parsed,
      config: {
        ...config,
        severityRules: { valueMap: { WARNING: "error" } },
      },
      now,
    });
    expect(line.band).toBe("error");
  });

  it("leaves the band unchanged when no valueMap key matches the keyword", () => {
    // PRI 14 -> severity 6 -> keyword "info"; a map for "err" does not match.
    const parsed = parseSyslog5424("<14>1 - - - - - - just fyi")!;
    const line = syslogToIngestedLine({
      parsed,
      config: {
        ...config,
        severityRules: { valueMap: { err: "fatal" } },
      },
      now,
    });
    expect(line.band).toBe("info");
  });
});

describe("syslogToNormalizedLogRecord", () => {
  it("emits source facts only: PRI-derived number, keyword text, raw body, attrs", () => {
    const raw =
      '<11>1 2026-07-12T10:00:00.000Z host app 4711 ID1 ' +
      '[exampleSDID@32473 iut="3"] disk failure';
    const parsed = parseSyslog5424(raw)!;
    const record = syslogToNormalizedLogRecord({ parsed, now });

    expect(record.severityNumber).toBe(parsed.severityNumber);
    // The RFC 5424 keyword, preserved for valueMap keying (severity 3 -> "err").
    expect(record.severityText).toBe("err");
    expect(record.body).toBe("disk failure");
    expect(record.ts.toISOString()).toBe("2026-07-12T10:00:00.000Z");
    expect(record.attributes?.["host.name"]).toBe("host");
    expect(record.attributes?.["app.name"]).toBe("app");
    expect(record.attributes?.["proc.id"]).toBe("4711");
    expect(record.attributes?.["msg.id"]).toBe("ID1");
    expect(record.attributes?.["sd.exampleSDID@32473.iut"]).toBe("3");
  });

  it("falls back to now for a nil timestamp and drops the checkstack SD element", () => {
    const raw =
      '<14>1 - host - - - [checkstack@50501 token="ckls_x"] hi there';
    const parsed = parseSyslog5424(raw)!;
    const record = syslogToNormalizedLogRecord({ parsed, now });
    expect(record.ts).toEqual(now);
    // The checkstack SD element never leaks into attributes on the platform path.
    expect(
      Object.keys(record.attributes ?? {}).some((k) => k.includes("checkstack")),
    ).toBe(false);
  });

  it("yields undefined attributes when the line carries none", () => {
    const parsed = parseSyslog5424("<14>1 - - - - - - bare")!;
    const record = syslogToNormalizedLogRecord({ parsed, now });
    expect(record.attributes).toBeUndefined();
  });

  // PARITY: a syslog line taken through the NEW source path (parse -> normalized
  // record -> sink normalization) stores the SAME line the OLD direct-to-pipeline
  // `syslogToIngestedLine` produced. band / severityNumber / body / attributes /
  // ts are byte-identical across all eight severities; the ONE intentional
  // difference is that the new path additionally preserves the syslog keyword as
  // `severityText` (the old path discarded it), which is required to keep the
  // keyword-based `valueMap` override working.
  describe("parity with syslogToIngestedLine (old direct path)", () => {
    for (let pri = 8; pri <= 15; pri += 1) {
      it(`stores an identical line for PRI ${pri}`, () => {
        const raw = `<${pri}>1 2026-07-12T10:00:00.000Z host app 4711 ID1 [sd@1 a="b"] the message`;
        const parsed = parseSyslog5424(raw)!;

        const oldLine = syslogToIngestedLine({ parsed, config, now });
        const record = syslogToNormalizedLogRecord({ parsed, now });
        const newLine = referenceSinkLine({
          record,
          streamConfig: config,
          observedAt: now,
        });

        expect(newLine.band).toBe(oldLine.band);
        expect(newLine.severityNumber).toBe(oldLine.severityNumber);
        expect(newLine.body).toBe(oldLine.body);
        expect(newLine.attributes).toEqual(oldLine.attributes);
        expect(newLine.ts).toEqual(oldLine.ts);
      });
    }

    it("preserves the keyword-based valueMap override through the sink path", () => {
      // PRI 11 -> "err"; a stream remapping syslog errors to fatal must still fire.
      const parsed = parseSyslog5424("<11>1 - - - - - - disk failure")!;
      const streamConfig: LogStreamConfig = {
        ...config,
        severityRules: { valueMap: { err: "fatal" } },
      };
      const oldLine = syslogToIngestedLine({ parsed, config: streamConfig, now });
      const record = syslogToNormalizedLogRecord({ parsed, now });
      const newLine = referenceSinkLine({ record, streamConfig, observedAt: now });
      expect(oldLine.band).toBe("fatal");
      expect(newLine.band).toBe("fatal");
    });

    it("enriches severityText with the syslog keyword the old path dropped", () => {
      const parsed = parseSyslog5424("<11>1 - - - - - - disk failure")!;
      const oldLine = syslogToIngestedLine({ parsed, config, now });
      const record = syslogToNormalizedLogRecord({ parsed, now });
      expect(oldLine.severityText).toBeUndefined();
      expect(record.severityText).toBe("err");
    });
  });
});
