import { describe, expect, it } from "bun:test";

import {
  AutomationDefinitionSchema,
  type ActionInput,
  type AutomationDefinition,
} from "./schemas";
import {
  collectExpressionDelimiterIssues,
  EXPRESSION_TEMPLATE_DELIMITER_MESSAGE,
} from "./expression-validation";

/** A minimal, fully-defaulted provider action leaf for sequences. */
function logAction(): ActionInput {
  return {
    action: "automation.log",
    config: { message: "x" },
    enabled: true,
    continue_on_error: false,
  };
}

/**
 * Build a fully-defaulted definition so the walker can be exercised with just
 * the triggers / conditions / actions under test.
 */
function makeDefinition(
  overrides: Partial<AutomationDefinition>,
): AutomationDefinition {
  return {
    name: "test",
    triggers: [{ event: "test.event" }],
    conditions: [],
    actions: [],
    mode: "single",
    concurrency_scope: "automation",
    max_runs: 10,
    ...overrides,
  };
}

describe("collectExpressionDelimiterIssues", () => {
  it("flags a {{ }} template wrapped around a choose.when expression", () => {
    const def = makeDefinition({
      actions: [
        {
          choose: [
            {
              when: "{{ not artifacts.find.issue_search.found }}",
              sequence: [logAction()],
            },
          ],
        },
      ],
    });

    const issues = collectExpressionDelimiterIssues(def);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(["actions", 0, "choose", 0, "when"]);
    expect(issues[0]?.message).toBe(EXPRESSION_TEMPLATE_DELIMITER_MESSAGE);
  });

  it("accepts a clean bare expression", () => {
    const def = makeDefinition({
      actions: [
        {
          choose: [
            {
              when: "artifacts.find.issue_search.found != true",
              sequence: [logAction()],
            },
          ],
        },
      ],
    });
    expect(collectExpressionDelimiterIssues(def)).toEqual([]);
  });

  it("flags template delimiters in every expression-bearing field", () => {
    const def = makeDefinition({
      triggers: [
        {
          event: "test.event",
          filter: "{{ trigger.payload.x }}",
          window: { count: 1, minutes: 5, refire: "every", partitionBy: "{{ trigger.payload.y }}" },
        },
      ],
      conditions: ["{{ trigger.payload.z }}"],
      actions: [
        { condition: "{{ a }}" },
        { wait_until: { condition: "{{ b }}" } },
        { wait_for_trigger: { event: "e", filter: "{{ c }}" } },
        {
          repeat: {
            while: "{{ d }}",
            sequence: [logAction()],
          },
        },
        { condition: { numeric_state: { value: "{{ e }}", above: 1 } } },
        {
          condition: {
            and: ["{{ f }}", { not: "{{ g }}" }],
          },
        },
      ],
    });

    const paths = collectExpressionDelimiterIssues(def).map((i) =>
      i.path.join("."),
    );
    expect(paths).toEqual([
      "triggers.0.filter",
      "triggers.0.window.partitionBy",
      "conditions.0",
      "actions.0.condition",
      "actions.1.wait_until.condition",
      "actions.2.wait_for_trigger.filter",
      "actions.3.repeat.while",
      "actions.4.condition.numeric_state.value",
      "actions.5.condition.and.0",
      "actions.5.condition.and.1.not",
    ]);
  });

  it("does NOT flag {{ }} inside a template field (action config)", () => {
    const def = makeDefinition({
      actions: [
        {
          ...logAction(),
          config: { message: "value is {{ trigger.payload.x }}" },
        },
      ],
    });
    expect(collectExpressionDelimiterIssues(def)).toEqual([]);
  });
});

describe("AutomationDefinitionSchema superRefine", () => {
  it("rejects a definition with a {{ }} template in a when expression", () => {
    const result = AutomationDefinitionSchema.safeParse({
      name: "bad",
      triggers: [{ event: "test.event" }],
      actions: [
        {
          choose: [
            {
              when: "{{ artifacts.find.issue_search.found }}",
              sequence: [logAction()],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(EXPRESSION_TEMPLATE_DELIMITER_MESSAGE);
    }
  });

  it("accepts a definition whose expressions are bare", () => {
    const result = AutomationDefinitionSchema.safeParse({
      name: "good",
      triggers: [{ event: "test.event" }],
      actions: [
        {
          choose: [
            {
              when: "artifacts.find.issue_search.found != true",
              sequence: [logAction()],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
