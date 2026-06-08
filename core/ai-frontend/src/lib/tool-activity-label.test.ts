import { describe, expect, test } from "bun:test";
import { toolActivityLabel } from "./tool-activity-label";

describe("toolActivityLabel", () => {
  test("maps known tools to friendly phrases", () => {
    expect(toolActivityLabel("ai_searchDocs")).toBe("Searching documentation");
    expect(toolActivityLabel("healthcheck_runHistory")).toBe(
      "Reading health-check history",
    );
    expect(toolActivityLabel("slo_listObjectives")).toBe("Checking SLOs");
    expect(toolActivityLabel("automation_propose")).toBe(
      "Preparing an automation",
    );
  });

  test("normalises dot-separated ids to the same label", () => {
    expect(toolActivityLabel("ai.searchDocs")).toBe(
      toolActivityLabel("ai_searchDocs"),
    );
  });

  test("derives a verb phrase for an unmapped tool from its action prefix", () => {
    // Not in the curated map: phrased from the leading verb + humanised rest.
    expect(toolActivityLabel("widget_listGadgets")).toBe("Checking gadgets");
    expect(toolActivityLabel("widget.getThing")).toBe("Reading thing");
  });

  test("humanises an unmapped tool with no recognised verb", () => {
    expect(toolActivityLabel("widget_frobnicate")).toBe("Frobnicate");
  });

  test("falls back to the raw id when there is nothing to humanise", () => {
    expect(toolActivityLabel("")).toBe("");
  });
});
