import { describe, expect, it } from "bun:test";
import type {
  LogPattern,
  PatternVariableSample,
  StreamForPicker,
} from "@checkstack/logstream-common";
import {
  patternToOption,
  readCollectorPatternId,
  readSelectedStreamId,
  streamToOption,
  truncatePatternLabel,
  variableToOption,
} from "./health-options-resolvers";

describe("streamToOption", () => {
  it("maps id to value and name to label", () => {
    const stream: StreamForPicker = { id: "s1", name: "prod-api" };
    expect(streamToOption(stream)).toEqual({ value: "s1", label: "prod-api" });
  });
});

describe("truncatePatternLabel", () => {
  it("collapses whitespace to a single line", () => {
    expect(truncatePatternLabel("failed  to\n connect\tto <*>")).toBe(
      "failed to connect to <*>",
    );
  });

  it("leaves short templates untouched", () => {
    expect(truncatePatternLabel("short <*>", 80)).toBe("short <*>");
  });

  it("truncates long templates with an ellipsis at the cap", () => {
    const long = "x".repeat(200);
    const label = truncatePatternLabel(long, 20);
    expect(label.length).toBe(20);
    expect(label.endsWith("…")).toBe(true);
  });
});

describe("patternToOption", () => {
  it("uses the pattern id as value and the truncated template as label", () => {
    const pattern = {
      id: "p1",
      streamId: "s1",
      template: "user   <*>  logged in",
      tokenCount: 3,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      sampleBody: "user 42 logged in",
      totalCount: 10,
      severityMax: 9,
      band: "info",
      origin: "mined",
    } satisfies LogPattern;
    expect(patternToOption(pattern)).toEqual({
      value: "p1",
      label: "user <*> logged in",
    });
  });
});

describe("readSelectedStreamId", () => {
  it("returns the streamId when a non-empty string is present", () => {
    expect(readSelectedStreamId({ streamId: "s1" })).toBe("s1");
  });

  it("returns undefined for an empty, missing, or non-string streamId", () => {
    expect(readSelectedStreamId({ streamId: "" })).toBeUndefined();
    expect(readSelectedStreamId({})).toBeUndefined();
    expect(readSelectedStreamId({ streamId: 42 })).toBeUndefined();
  });
});

describe("readCollectorPatternId", () => {
  it("returns the patternId from the collector's own form values", () => {
    expect(readCollectorPatternId({ patternId: "p1" })).toBe("p1");
  });

  it("returns undefined for an empty, missing, or non-string patternId", () => {
    expect(readCollectorPatternId({ patternId: "" })).toBeUndefined();
    expect(readCollectorPatternId({})).toBeUndefined();
    expect(readCollectorPatternId({ patternId: 3 })).toBeUndefined();
  });
});

describe("variableToOption", () => {
  const WINDOW_24H = 24 * 3600;
  const make = (
    over: Partial<PatternVariableSample> = {},
  ): PatternVariableSample => ({
    varIndex: 2,
    context: "latency <*> ms",
    sampleValues: ["12", "40", "3"],
    numericShare: 1,
    ...over,
  });
  const toOption = (
    over: Partial<PatternVariableSample> = {},
    summaryWindowSeconds: number = WINDOW_24H,
  ) => variableToOption({ variable: make(over), summaryWindowSeconds });

  it("labels a numeric position with its index, template context, and sample preview", () => {
    expect(toOption()).toEqual({
      value: "2",
      label: "Variable 2 (latency <*> ms) - samples: 12, 40, 3",
    });
  });

  it("omits the context parenthetical when the backend sent none", () => {
    expect(toOption({ context: "" }).label).toBe(
      "Variable 2 - samples: 12, 40, 3",
    );
  });

  it("flags a non-numeric-majority position that HAS samples", () => {
    expect(toOption({ numericShare: 0.4 }).label).toBe(
      "Variable 2 (latency <*> ms) - samples: 12, 40, 3 (not numeric)",
    );
  });

  it("treats an exactly-half numeric share as numeric", () => {
    expect(toOption({ numericShare: 0.5 }).label).not.toContain(
      "(not numeric)",
    );
  });

  it("caps the preview at three samples", () => {
    expect(toOption({ sampleValues: ["1", "2", "3", "4", "5"] }).label).toBe(
      "Variable 2 (latency <*> ms) - samples: 1, 2, 3",
    );
  });

  it("reads the index as the option value (stored 0-based)", () => {
    expect(toOption({ varIndex: 0 }).value).toBe("0");
  });

  it("says 'no samples in the last <window>' - never '(not numeric)' - for an empty summary", () => {
    // No samples is not evidence of non-numericness: the values may be
    // perfectly numeric but simply older than the summary window.
    expect(toOption({ sampleValues: [], numericShare: 0 }).label).toBe(
      "Variable 2 (latency <*> ms) - no samples in the last 24h",
    );
  });

  it("renders the ACTUAL summary window, not a hardcoded 24h", () => {
    expect(
      toOption({ sampleValues: [], numericShare: 0 }, 2 * 86_400).label,
    ).toContain("in the last 2d");
    expect(
      toOption({ sampleValues: [], numericShare: 0 }, 5_400).label,
    ).toContain("in the last 90m");
  });
});
