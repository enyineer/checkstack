import { describe, it, expect } from "bun:test";
import { DEFAULT_LOG_STREAM_CONFIG } from "../../schemas";
import { parseSyslog5424, syslogToIngestedLine } from "./syslog";

const config = DEFAULT_LOG_STREAM_CONFIG;
const now = new Date("2026-07-12T12:00:00.000Z");

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
