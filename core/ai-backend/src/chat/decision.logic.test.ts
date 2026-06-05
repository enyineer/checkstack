import { describe, expect, test } from "bun:test";
import { buildDecisionNote } from "./decision.logic";

describe("buildDecisionNote", () => {
  test("apply note states it is live, uses the summary, and forbids re-proposing", () => {
    const note = buildDecisionNote({
      decision: "apply",
      toolName: "healthcheck.propose",
      summary: 'Create health check "google-com-http" running every 60s',
    });
    expect(note).toContain("APPLIED");
    expect(note).toContain("now live");
    expect(note).toContain('Create health check "google-com-http"');
    expect(note).toContain("Do NOT propose it again");
  });

  test("decline note states nothing changed and asks what to adjust", () => {
    const note = buildDecisionNote({
      decision: "decline",
      toolName: "healthcheck.propose",
      summary: "Create health check X",
    });
    expect(note).toContain("DECLINED");
    expect(note).toContain("Nothing was changed");
    expect(note).toContain("adjust");
    expect(note).toContain("Do NOT re-propose");
  });

  test("falls back to the tool name when no summary is stored", () => {
    const note = buildDecisionNote({
      decision: "apply",
      toolName: "automation.propose",
    });
    expect(note).toContain('the proposed "automation.propose" action');
  });

  test("ignores a blank summary and falls back to the tool name", () => {
    const note = buildDecisionNote({
      decision: "decline",
      toolName: "automation.propose",
      summary: "   ",
    });
    expect(note).toContain('the proposed "automation.propose" action');
  });
});
