import { describe, expect, it } from "bun:test";
import type { ActionRunScope } from "@checkstack/automation-backend";
import { flattenScopeToShellEnv } from "./script-env";

function scope(overrides: Partial<ActionRunScope> = {}): ActionRunScope {
  return {
    trigger: { event: "incident.created", payload: {} },
    artifacts: {},
    vars: {},
    ...overrides,
  };
}

describe("flattenScopeToShellEnv", () => {
  it("exposes the trigger event", () => {
    const env = flattenScopeToShellEnv(scope());
    expect(env.CHECKSTACK_TRIGGER_EVENT).toBe("incident.created");
  });

  it("emits no JSON blob (the container has no jq)", () => {
    const env = flattenScopeToShellEnv(
      scope({
        trigger: { event: "incident.created", payload: { title: "Outage" } },
      }),
    );
    expect(env.CHECKSTACK_CONTEXT).toBeUndefined();
    // Every value is a plain string, never JSON.
    for (const value of Object.values(env)) {
      expect(value.trimStart().startsWith("{")).toBe(false);
    }
  });

  it("flattens scalar payload fields to CHECKSTACK_TRIGGER_PAYLOAD_*", () => {
    const env = flattenScopeToShellEnv(
      scope({
        trigger: {
          event: "incident.created",
          payload: { title: "Outage", severity: "high", count: 3, urgent: true },
        },
      }),
    );
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_TITLE).toBe("Outage");
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_SEVERITY).toBe("high");
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_COUNT).toBe("3");
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_URGENT).toBe("true");
  });

  it("flattens artifacts under CHECKSTACK_ARTIFACT_<TYPE>_<FIELD>", () => {
    const env = flattenScopeToShellEnv(
      scope({
        artifacts: { "jira.issue": { key: "OPS-1", url: "https://x/OPS-1" } },
      }),
    );
    expect(env.CHECKSTACK_ARTIFACT_JIRA_ISSUE_KEY).toBe("OPS-1");
    expect(env.CHECKSTACK_ARTIFACT_JIRA_ISSUE_URL).toBe("https://x/OPS-1");
  });

  it("flattens variables and recurses nested objects", () => {
    const env = flattenScopeToShellEnv(
      scope({ vars: { region: "eu", limits: { max: 10 } } }),
    );
    expect(env.CHECKSTACK_VAR_REGION).toBe("eu");
    expect(env.CHECKSTACK_VAR_LIMITS_MAX).toBe("10");
  });

  it("joins scalar array elements with newlines (jq-free iteration)", () => {
    const env = flattenScopeToShellEnv(
      scope({
        trigger: {
          event: "incident.created",
          payload: { systemIds: ["a", "b"] },
        },
      }),
    );
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_SYSTEMIDS).toBe("a\nb");
  });

  it("also exposes scalar array elements by index (editor parity)", () => {
    const env = flattenScopeToShellEnv(
      scope({
        trigger: {
          event: "incident.created",
          payload: { systemIds: ["a", "b"] },
        },
      }),
    );
    // Whole-array var unchanged…
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_SYSTEMIDS).toBe("a\nb");
    // …and each element is now additionally indexed.
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_SYSTEMIDS_0).toBe("a");
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_SYSTEMIDS_1).toBe("b");
  });

  it("exposes object-array element fields by index, plus the JSON-per-line whole-array var", () => {
    const env = flattenScopeToShellEnv(
      scope({
        trigger: {
          event: "incident.created",
          payload: {
            comments: [{ author: "alice" }, { author: "bob" }],
          },
        },
      }),
    );
    // Object element fields are indexed.
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_COMMENTS_0_AUTHOR).toBe("alice");
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_COMMENTS_1_AUTHOR).toBe("bob");
    // Whole-array var holds the JSON-per-line form for non-scalar elements.
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_COMMENTS).toBe(
      '{"author":"alice"}\n{"author":"bob"}',
    );
  });

  it("exposes repeat context when present", () => {
    const env = flattenScopeToShellEnv(
      scope({ repeat: { index: 2, item: "x" } }),
    );
    expect(env.CHECKSTACK_REPEAT_INDEX).toBe("2");
    expect(env.CHECKSTACK_REPEAT_ITEM).toBe("x");
  });
});
