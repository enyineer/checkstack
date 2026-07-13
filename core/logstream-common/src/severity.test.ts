import { describe, it, expect } from "bun:test";
import {
  SEVERITY_BANDS,
  SEVERITY_BAND_RANK,
  bandFromSeverityNumber,
  bandFromLevelName,
  bandFromSyslogSeverity,
  bandFromSyslogPri,
  worstBand,
  type SeverityBand,
} from "./severity";

describe("bandFromSeverityNumber", () => {
  const cases: Array<[number, SeverityBand]> = [
    [1, "trace"],
    [4, "trace"],
    [5, "debug"],
    [8, "debug"],
    [9, "info"],
    [12, "info"],
    [13, "warn"],
    [16, "warn"],
    [17, "error"],
    [20, "error"],
    [21, "fatal"],
    [24, "fatal"],
  ];
  it.each(cases)("maps %d -> %s", (n, band) => {
    expect(bandFromSeverityNumber(n)).toBe(band);
  });

  it("defaults 0/unknown/out-of-range to info", () => {
    expect(bandFromSeverityNumber(0)).toBe("info");
    expect(bandFromSeverityNumber(25)).toBe("info");
    expect(bandFromSeverityNumber(-3)).toBe("info");
    expect(bandFromSeverityNumber(Number.NaN)).toBe("info");
  });

  it("truncates fractional numbers into their band", () => {
    expect(bandFromSeverityNumber(17.9)).toBe("error");
  });
});

describe("bandFromLevelName", () => {
  const cases: Array<[string, SeverityBand]> = [
    ["TRACE", "trace"],
    ["verbose", "trace"],
    ["debug", "debug"],
    ["Fine", "debug"],
    ["info", "info"],
    ["Information", "info"],
    ["notice", "info"],
    ["warn", "warn"],
    ["Warning", "warn"],
    ["error", "error"],
    ["err", "error"],
    ["fatal", "fatal"],
    ["critical", "fatal"],
    ["emerg", "fatal"],
    ["panic", "fatal"],
  ];
  it.each(cases)("maps %s -> %s", (name, band) => {
    expect(bandFromLevelName(name)).toBe(band);
  });

  it("returns null for empty/unknown names", () => {
    expect(bandFromLevelName("")).toBeNull();
    expect(bandFromLevelName("   ")).toBeNull();
    expect(bandFromLevelName("banana")).toBeNull();
  });
});

describe("bandFromSyslogSeverity / bandFromSyslogPri", () => {
  const cases: Array<[number, SeverityBand]> = [
    [0, "fatal"],
    [1, "fatal"],
    [2, "fatal"],
    [3, "error"],
    [4, "warn"],
    [5, "info"],
    [6, "info"],
    [7, "debug"],
  ];
  it.each(cases)("severity %d -> %s", (sev, band) => {
    expect(bandFromSyslogSeverity(sev)).toBe(band);
  });

  it("extracts severity from a PRI (facility*8 + severity)", () => {
    // PRI 34 = facility 4, severity 2 -> fatal
    expect(bandFromSyslogPri(34)).toBe("fatal");
    // PRI 165 = facility 20, severity 5 -> info
    expect(bandFromSyslogPri(165)).toBe("info");
    // PRI 13 = facility 1, severity 5 -> info
    expect(bandFromSyslogPri(13)).toBe("info");
  });

  it("defaults non-finite PRI to info", () => {
    expect(bandFromSyslogPri(Number.NaN)).toBe("info");
  });
});

describe("worstBand", () => {
  it("returns the higher-ranked band", () => {
    expect(worstBand({ a: "info", b: "error" })).toBe("error");
    expect(worstBand({ a: "fatal", b: "warn" })).toBe("fatal");
    expect(worstBand({ a: "trace", b: "trace" })).toBe("trace");
  });

  it("rank order is monotonic over SEVERITY_BANDS", () => {
    for (let i = 1; i < SEVERITY_BANDS.length; i++) {
      expect(SEVERITY_BAND_RANK[SEVERITY_BANDS[i]]).toBeGreaterThan(
        SEVERITY_BAND_RANK[SEVERITY_BANDS[i - 1]],
      );
    }
  });
});
