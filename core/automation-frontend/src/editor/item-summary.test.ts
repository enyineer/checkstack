import { describe, it, expect } from "bun:test";
import type {
  ActionInput,
  ConditionInput,
} from "@checkstack/automation-common";
import {
  summarizeAction,
  summarizeCondition,
  summarizeTrigger,
} from "./item-summary";

describe("summarizeTrigger", () => {
  it("returns the event id when no advanced fields are set", () => {
    expect(summarizeTrigger({ event: "incident.created" })).toBe(
      "incident.created",
    );
  });

  it("appends the filter and dwell hints", () => {
    expect(
      summarizeTrigger({
        event: "incident.created",
        filter: "{{ trigger.payload.sev == 'high' }}",
        for: { minutes: 5 },
      }),
    ).toBe("incident.created · if {{ trigger.payload.sev == 'high' }} · with dwell");
  });

  it("appends the windowed-count rate hint", () => {
    expect(
      summarizeTrigger({
        event: "healthcheck.check_failed",
        window: { count: 3, minutes: 60, refire: "once" },
      }),
    ).toBe("healthcheck.check_failed · 3× / 60m");
  });

  it("includes the partition expression in the rate hint when set", () => {
    expect(
      summarizeTrigger({
        event: "healthcheck.check_failed",
        window: {
          count: 3,
          minutes: 60,
          refire: "once",
          partitionBy: "trigger.payload.severity",
        },
      }),
    ).toBe("healthcheck.check_failed · 3× / 60m by trigger.payload.severity");
  });

  it("returns undefined for an event-less trigger", () => {
    expect(summarizeTrigger({ event: "" })).toBeUndefined();
  });
});

describe("summarizeAction", () => {
  it("uses the local name for a provider action", () => {
    const action: ActionInput = {
      action: "integration-jira.create_issue",
      config: {},
      enabled: true,
      continue_on_error: false,
    };
    expect(summarizeAction(action)).toBe("create_issue");
  });

  it("returns undefined for an unpicked provider action", () => {
    const action: ActionInput = {
      action: "",
      config: {},
      enabled: true,
      continue_on_error: false,
    };
    expect(summarizeAction(action)).toBeUndefined();
  });

  it("summarizes a choose by branch count and else", () => {
    const action: ActionInput = {
      enabled: true,
      continue_on_error: false,
      choose: [
        { when: "a", sequence: [] },
        { when: "b", sequence: [] },
      ],
      else: [
        {
          action: "automation.log",
          config: {},
          enabled: true,
          continue_on_error: false,
        },
      ],
    };
    expect(summarizeAction(action)).toBe("2 branches + else");
  });

  it("summarizes a single-branch choose without pluralizing", () => {
    const action: ActionInput = {
      enabled: true,
      continue_on_error: false,
      choose: [{ when: "a", sequence: [] }],
    };
    expect(summarizeAction(action)).toBe("1 branch");
  });

  it("summarizes a delay in seconds", () => {
    const action: ActionInput = {
      enabled: true,
      continue_on_error: false,
      delay: { seconds: 30 },
    };
    expect(summarizeAction(action)).toBe("delay 30s");
  });

  it("summarizes a repeat count", () => {
    const action: ActionInput = {
      enabled: true,
      continue_on_error: false,
      repeat: { count: 5, sequence: [] },
    };
    expect(summarizeAction(action)).toBe("count 5");
  });

  it("summarizes variables by name", () => {
    const action: ActionInput = {
      enabled: true,
      continue_on_error: false,
      variables: { foo: "1", bar: "2" },
    };
    expect(summarizeAction(action)).toBe("set foo, bar");
  });
});

describe("summarizeCondition", () => {
  it("returns the trimmed expression source", () => {
    expect(summarizeCondition("  trigger.payload.x == 1  ")).toBe(
      "trigger.payload.x == 1",
    );
  });

  it("labels an empty expression", () => {
    expect(summarizeCondition("")).toBe("empty expression");
  });

  it("summarizes combinators by child count", () => {
    expect(summarizeCondition({ and: ["a", "b"] })).toBe("all of 2");
    expect(summarizeCondition({ or: ["a"] })).toBe("any of 1");
  });

  it("summarizes a numeric_state with bounds", () => {
    const condition: ConditionInput = {
      numeric_state: { value: "health.p95", above: 100, below: 500 },
    };
    expect(summarizeCondition(condition)).toBe("health.p95 > 100 and < 500");
  });

  it("summarizes a system state condition", () => {
    const condition: ConditionInput = {
      state: { entity: "api", status: "unhealthy" },
    };
    expect(summarizeCondition(condition)).toBe("api is unhealthy");
  });

  it("clips very long expressions", () => {
    const long = "x".repeat(200);
    const out = summarizeCondition(long);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("…")).toBe(true);
  });
});
