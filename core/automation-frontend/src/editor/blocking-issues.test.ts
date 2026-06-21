/**
 * Tests for the save-blockers summary that explains why the automation Save
 * button is disabled. The list must mirror the page's `canSave` predicate
 * (name + run-as + definition validation) so the count and the disabled state
 * never disagree.
 */
import { describe, expect, it } from "bun:test";
import { summarizeBlockingIssues } from "./blocking-issues";

describe("summarizeBlockingIssues", () => {
  it("returns no blockers when everything is valid", () => {
    expect(
      summarizeBlockingIssues({ definitionIssues: [] }),
    ).toEqual([]);
  });

  it("includes the name error targeting the name field", () => {
    const blockers = summarizeBlockingIssues({
      nameError: "Name is required",
      definitionIssues: [],
    });
    expect(blockers).toEqual([
      { message: "Name is required", target: { kind: "field", field: "name" } },
    ]);
  });

  it("includes the run-as error targeting the run-as field", () => {
    const blockers = summarizeBlockingIssues({
      runAsError: "A service account is required",
      definitionIssues: [],
    });
    expect(blockers).toEqual([
      {
        message: "A service account is required",
        target: { kind: "field", field: "runAs" },
      },
    ]);
  });

  it("formats a definition issue as `path: message`", () => {
    const blockers = summarizeBlockingIssues({
      definitionIssues: [
        { path: ["triggers", 0, "kind"], message: "Required" },
      ],
    });
    expect(blockers).toEqual([
      { message: "triggers.0.kind: Required", target: { kind: "definition" } },
    ]);
  });

  it("renders a top-level (pathless) definition issue as just its message", () => {
    const blockers = summarizeBlockingIssues({
      definitionIssues: [
        { path: [], message: "An automation needs at least one trigger." },
      ],
    });
    expect(blockers).toEqual([
      {
        message: "An automation needs at least one trigger.",
        target: { kind: "definition" },
      },
    ]);
  });

  it("orders blockers name → run-as → definition issues", () => {
    const blockers = summarizeBlockingIssues({
      nameError: "Name is required",
      runAsError: "A service account is required",
      definitionIssues: [{ path: ["actions"], message: "bad" }],
    });
    expect(blockers.map((b) => b.target)).toEqual([
      { kind: "field", field: "name" },
      { kind: "field", field: "runAs" },
      { kind: "definition" },
    ]);
  });
});
