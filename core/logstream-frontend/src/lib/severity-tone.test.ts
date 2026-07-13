import { describe, expect, it } from "bun:test";
import type { SeverityBand } from "@checkstack/logstream-common";
import { IMPORTANT_EVENT_TYPES, SEVERITY_BANDS } from "@checkstack/logstream-common";
import {
  importantEventVisual,
  severityBandIcon,
  severityBandLabel,
  severityBandToStackTone,
  severityBandToTone,
} from "./severity-tone";

describe("severityBandToTone", () => {
  it("maps error and fatal to the error tone", () => {
    expect(severityBandToTone("error")).toBe("error");
    expect(severityBandToTone("fatal")).toBe("error");
  });

  it("maps warn to warn, info to info", () => {
    expect(severityBandToTone("warn")).toBe("warn");
    expect(severityBandToTone("info")).toBe("info");
  });

  it("maps debug and trace to neutral", () => {
    expect(severityBandToTone("debug")).toBe("neutral");
    expect(severityBandToTone("trace")).toBe("neutral");
  });

  it("returns a tone for every band", () => {
    for (const band of SEVERITY_BANDS) {
      expect(severityBandToTone(band)).toBeTruthy();
    }
  });
});

describe("severityBandToStackTone", () => {
  it("folds bands into the three visible stacks", () => {
    expect(severityBandToStackTone("fatal")).toBe("down");
    expect(severityBandToStackTone("error")).toBe("down");
    expect(severityBandToStackTone("warn")).toBe("warn");
    expect(severityBandToStackTone("info")).toBe("ok");
    expect(severityBandToStackTone("debug")).toBe("unknown");
    expect(severityBandToStackTone("trace")).toBe("unknown");
  });
});

describe("severityBandIcon / severityBandLabel", () => {
  it("returns an icon component for every band", () => {
    for (const band of SEVERITY_BANDS) {
      expect(typeof severityBandIcon(band)).not.toBe("undefined");
    }
  });

  it("capitalises the band label", () => {
    const cases: Record<SeverityBand, string> = {
      trace: "Trace",
      debug: "Debug",
      info: "Info",
      warn: "Warn",
      error: "Error",
      fatal: "Fatal",
    };
    for (const [band, label] of Object.entries(cases)) {
      expect(severityBandLabel(band as SeverityBand)).toBe(label);
    }
  });
});

describe("importantEventVisual", () => {
  it("returns an icon, tone and label for every event type", () => {
    for (const type of IMPORTANT_EVENT_TYPES) {
      const v = importantEventVisual(type);
      expect(v.icon).toBeTruthy();
      expect(v.tone).toBeTruthy();
      expect(v.label.length).toBeGreaterThan(0);
    }
  });

  it("tones a recovery as ok and a spike as error", () => {
    expect(importantEventVisual("silence_recovered").tone).toBe("ok");
    expect(importantEventVisual("spike").tone).toBe("error");
    expect(importantEventVisual("silence").tone).toBe("warn");
  });
});
