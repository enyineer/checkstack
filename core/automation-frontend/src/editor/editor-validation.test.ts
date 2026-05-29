/**
 * Tests for the issue-ownership grouping that drives per-card error
 * marking in the visual editor.
 */
import { describe, expect, it } from "bun:test";
import {
  actionPathToDefPath,
  defPathKey,
  partitionIssues,
} from "./editor-validation";

describe("actionPathToDefPath", () => {
  it("maps a root action", () => {
    expect(actionPathToDefPath([{ slot: "root", index: 2 }])).toEqual([
      "actions",
      2,
    ]);
  });

  it("maps a nested choose-when action", () => {
    expect(
      actionPathToDefPath([
        { slot: "root", index: 0 },
        { slot: "choose-when", whenIndex: 1, index: 3 },
      ]),
    ).toEqual(["actions", 0, "choose", 1, "sequence", 3]);
  });

  it("maps repeat + sequence nesting", () => {
    expect(
      actionPathToDefPath([
        { slot: "root", index: 0 },
        { slot: "repeat", index: 1 },
      ]),
    ).toEqual(["actions", 0, "repeat", "sequence", 1]);
  });
});

describe("partitionIssues", () => {
  it("attaches a provider config issue to its action's defPath key", () => {
    const { actions } = partitionIssues([
      { path: ["actions", 0, "config", "level"], message: "Invalid enum" },
    ]);
    // Key is the space-joined defPath of the owning action.
    expect(actions.get(defPathKey(["actions", 0]))).toEqual(["config.level: Invalid enum"]);
  });

  it("attaches a nested action's config to the nested card, not the parent", () => {
    const { actions } = partitionIssues([
      {
        path: ["actions", 0, "choose", 1, "sequence", 2, "config", "x"],
        message: "bad",
      },
    ]);
    expect(actions.get(defPathKey(["actions", 0, "choose", 1, "sequence", 2]))).toEqual([
      "config.x: bad",
    ]);
    expect(actions.has(defPathKey(["actions", 0]))).toBe(false);
  });

  it("attaches a choose's own `when` to the choose card", () => {
    const { actions } = partitionIssues([
      { path: ["actions", 0, "choose", 0, "when"], message: "required" },
    ]);
    expect(actions.get(defPathKey(["actions", 0]))).toEqual(["choose.0.when: required"]);
  });

  it("routes trigger + condition issues to their own buckets", () => {
    const { triggers, conditions } = partitionIssues([
      {
        path: ["triggers", 1, "config", "intervalSeconds"],
        message: "too small",
      },
      { path: ["conditions", 0], message: "bad template" },
    ]);
    expect(triggers.get(1)).toEqual(["config.intervalSeconds: too small"]);
    expect(conditions.get(0)).toEqual(["bad template"]);
  });

  it("collects unattributable top-level issues under `other`", () => {
    const { other } = partitionIssues([
      { path: ["name"], message: "Required" },
      { path: ["max_runs"], message: "Too big" },
    ]);
    expect(other).toEqual(["name: Required", "max_runs: Too big"]);
  });

  it("groups multiple issues on the same action", () => {
    const { actions } = partitionIssues([
      { path: ["actions", 0, "config", "a"], message: "x" },
      { path: ["actions", 0, "config", "b"], message: "y" },
    ]);
    expect(actions.get(defPathKey(["actions", 0]))).toEqual(["config.a: x", "config.b: y"]);
  });
});
