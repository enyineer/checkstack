import { describe, expect, test } from "bun:test";
import { flattenScopeToShellEnv } from "./script-test-shell-env";

describe("flattenScopeToShellEnv (test context)", () => {
  test("emits trigger.event even for an empty context", () => {
    expect(flattenScopeToShellEnv(undefined)).toEqual({
      CHECKSTACK_TRIGGER_EVENT: "",
    });
  });

  test("flattens nested payload objects into dotted env keys", () => {
    const env = flattenScopeToShellEnv({
      trigger: { event: "incident.created", payload: { id: "INC-1", nested: { level: 2 } } },
    });
    expect(env.CHECKSTACK_TRIGGER_EVENT).toBe("incident.created");
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_ID).toBe("INC-1");
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_NESTED_LEVEL).toBe("2");
  });

  test("indexes array elements and emits a newline-joined whole-array var", () => {
    const env = flattenScopeToShellEnv({
      trigger: { event: "e", payload: { tags: ["a", "b"] } },
    });
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_TAGS).toBe("a\nb");
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_TAGS_0).toBe("a");
    expect(env.CHECKSTACK_TRIGGER_PAYLOAD_TAGS_1).toBe("b");
  });

  test("flattens artifacts, vars and repeat", () => {
    const env = flattenScopeToShellEnv({
      trigger: { event: "e" },
      artifacts: { jira_issue: { key: "PROJ-1" } },
      var: { count: 5 },
      repeat: { index: 3, item: { name: "x" } },
    });
    expect(env.CHECKSTACK_ARTIFACT_JIRA_ISSUE_KEY).toBe("PROJ-1");
    expect(env.CHECKSTACK_VAR_COUNT).toBe("5");
    expect(env.CHECKSTACK_REPEAT_INDEX).toBe("3");
    expect(env.CHECKSTACK_REPEAT_ITEM_NAME).toBe("x");
  });
});
