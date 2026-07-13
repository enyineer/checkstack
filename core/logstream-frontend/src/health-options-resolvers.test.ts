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
  const make = (
    over: Partial<PatternVariableSample> = {},
  ): PatternVariableSample => ({
    varIndex: 2,
    sampleValues: ["12", "40", "3"],
    numericShare: 1,
    ...over,
  });

  it("labels a numeric position with its index and sample preview", () => {
    expect(variableToOption(make())).toEqual({
      value: "2",
      label: "Variable 2 - samples: 12, 40, 3",
    });
  });

  it("flags a non-numeric-majority position", () => {
    expect(variableToOption(make({ numericShare: 0.4 })).label).toBe(
      "Variable 2 - samples: 12, 40, 3 (not numeric)",
    );
  });

  it("treats an exactly-half numeric share as numeric", () => {
    expect(variableToOption(make({ numericShare: 0.5 })).label).not.toContain(
      "(not numeric)",
    );
  });

  it("caps the preview at three samples", () => {
    expect(
      variableToOption(make({ sampleValues: ["1", "2", "3", "4", "5"] })).label,
    ).toBe("Variable 2 - samples: 1, 2, 3");
  });

  it("reads the index as the option value (stored 0-based)", () => {
    expect(variableToOption(make({ varIndex: 0 })).value).toBe("0");
  });

  it("handles a position with no recent samples", () => {
    expect(variableToOption(make({ sampleValues: [], numericShare: 0 })).label).toBe(
      "Variable 2 - no recent samples (not numeric)",
    );
  });
});
