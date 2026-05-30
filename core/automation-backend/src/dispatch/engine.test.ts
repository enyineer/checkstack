import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import { createActionRegistry } from "../action-registry";
import { createArtifactTypeRegistry } from "../artifact-type-registry";
import { dispatchTrigger, resumeRun } from "./engine";
import {
  makeDispatchDeps,
  makeFailingAction,
  makeRecordingAction,
  testPlugin,
} from "./test-fixtures";
import type { LoadedAutomation } from "./types";

/**
 * Build a minimal automation around a list of actions for tests.
 *
 * We accept `unknown[]` so test literals can omit `enabled` /
 * `continue_on_error` — zod fills the defaults during `parse()`.
 */
function automation(actions: unknown[]): LoadedAutomation {
  const definition = AutomationDefinitionSchema.parse({
    name: "Test",
    triggers: [{ event: "test.event" }],
    conditions: [],
    actions,
    mode: "single",
    max_runs: 10,
  });
  return {
    id: "auto-1",
    name: "Test",
    status: "enabled",
    definition,
  };
}

// ─── action ──────────────────────────────────────────────────────────────

describe("dispatch engine — action primitive", () => {
  it("executes a registered action with templated config", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction({ produces: true });
    actionsReg.register(rec.definition, testPlugin);

    const { deps, runs, artifacts } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        {
          id: "rec_step",
          action: "test.record",
          config: { value: "{{ trigger.payload.id }}" },
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { id: "incident-42" },
      contextKey: "incident-42",
    });

    expect(result.status).toBe("success");
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]?.value).toBe("incident-42");
    expect(artifacts.artifacts).toHaveLength(1);
    expect(artifacts.artifacts[0]?.artifactType).toBe("test.recorded");
    expect(artifacts.artifacts[0]?.actionId).toBe("rec_step");
    expect(runs.steps).toHaveLength(1);
    expect(runs.steps[0]?.status).toBe("success");
  });

  it("nests the produced artifact under artifacts.<id>.<localName> and resolves it downstream", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction({ produces: true });
    actionsReg.register(rec.definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        {
          id: "produce_it",
          action: "test.record",
          config: { value: "PROJ-1" },
        },
        {
          // This action also produces (it reuses `test.record`), so it must
          // carry an id too — the engine fails producers without one.
          id: "consume_it",
          action: "test.record",
          // The local artifact name for `test.recorded` is `recorded`; the
          // recording action's artifact shape is `{ recorded: <value> }`.
          config: {
            value: "{{ artifacts.produce_it.recorded.recorded }}",
          },
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: "ck-1",
    });

    expect(result.status).toBe("success");
    expect(rec.calls).toHaveLength(2);
    // The downstream action's templated config resolved to the produced
    // artifact field.
    expect(rec.calls[1]?.value).toBe("PROJ-1");
  });

  it("fails the run when the action is unknown", async () => {
    const { deps, runs } = makeDispatchDeps();
    const result = await dispatchTrigger(deps, {
      automation: automation([
        { action: "missing.action", config: {} },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("failed");
    expect(runs.steps[0]?.status).toBe("failed");
  });

  it("honours continue_on_error", async () => {
    const actionsReg = createActionRegistry();
    actionsReg.register(makeFailingAction(), testPlugin);
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);

    const { deps } = makeDispatchDeps({ actions: actionsReg });
    const result = await dispatchTrigger(deps, {
      automation: automation([
        {
          action: "test.fail",
          config: { reason: "expected" },
          continue_on_error: true,
        },
        { action: "test.record", config: { value: "after-fail" } },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
    expect(rec.calls).toHaveLength(1);
  });

  it("stops the run on failure without continue_on_error", async () => {
    const actionsReg = createActionRegistry();
    actionsReg.register(makeFailingAction(), testPlugin);
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);

    const { deps } = makeDispatchDeps({ actions: actionsReg });
    const result = await dispatchTrigger(deps, {
      automation: automation([
        { action: "test.fail", config: { reason: "expected" } },
        { action: "test.record", config: { value: "should not run" } },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("failed");
    expect(rec.calls).toHaveLength(0);
  });

  it("resolves consumed artifacts via the artifact store", async () => {
    const actionsReg = createActionRegistry();
    // Producer
    actionsReg.register(
      makeRecordingAction({ produces: true }).definition,
      testPlugin,
    );
    // Consumer
    const consumed: Array<Record<string, unknown>> = [];
    actionsReg.register(
      {
        id: "consumer",
        displayName: "Consumer",
        config: new Versioned({ version: 1, schema: z.object({}) }),
        // Local artifact id; resolved against this plugin's namespace
        // (`test.recorded`) and keyed back by the local id.
        consumes: ["recorded"],
        execute: async (ctx) => {
          consumed.push(ctx.consumedArtifacts);
          return { success: true };
        },
      },
      testPlugin,
    );

    const { deps } = makeDispatchDeps({ actions: actionsReg });
    await dispatchTrigger(deps, {
      automation: automation([
        { id: "producer", action: "test.record", config: { value: "x" } },
        { action: "test.consumer", config: {} },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: "ck-1",
    });
    expect(consumed[0]?.["recorded"]).toEqual({ recorded: "x" });
  });

  it("skips disabled actions", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        {
          action: "test.record",
          config: { value: "should-skip" },
          enabled: false,
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
    expect(rec.calls).toHaveLength(0);
    expect(runs.steps[0]?.status).toBe("skipped");
  });
});

// ─── choose ──────────────────────────────────────────────────────────────

describe("dispatch engine — choose primitive", () => {
  it("runs the matched branch", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        {
          choose: [
            {
              when: "trigger.payload.severity == 'critical'",
              sequence: [{ action: "test.record", config: { value: "high" } }],
            },
            {
              when: "trigger.payload.severity == 'info'",
              sequence: [{ action: "test.record", config: { value: "low" } }],
            },
          ],
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { severity: "critical" },
      contextKey: null,
    });
    expect(result.status).toBe("success");
    expect(rec.calls).toEqual([
      { value: "high", consumedArtifacts: {} },
    ]);
  });

  it("falls through to else when no branch matches", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        {
          choose: [
            {
              when: "false",
              sequence: [{ action: "test.record", config: { value: "no" } }],
            },
          ],
          else: [{ action: "test.record", config: { value: "fallback" } }],
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
    expect(rec.calls).toEqual([
      { value: "fallback", consumedArtifacts: {} },
    ]);
  });

  it("returns success with null branch when no match and no else", async () => {
    const { deps } = makeDispatchDeps();
    const result = await dispatchTrigger(deps, {
      automation: automation([
        {
          choose: [{ when: "false", sequence: [{ action: "x.y", config: {} }] }],
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
  });
});

// ─── parallel ────────────────────────────────────────────────────────────

describe("dispatch engine — parallel primitive", () => {
  it("runs branches concurrently", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        {
          parallel: [
            { action: "test.record", config: { value: "a" } },
            { action: "test.record", config: { value: "b" } },
            { action: "test.record", config: { value: "c" } },
          ],
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
    expect(rec.calls.map((c) => c.value).toSorted()).toEqual(["a", "b", "c"]);
  });
});

// ─── delay (queue-backed) ────────────────────────────────────────────────

describe("dispatch engine — delay primitive (queue-backed)", () => {
  it("suspends the run and enqueues a scheduled job", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs, queue } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      { action: "test.record", config: { value: "before-delay" } },
      { delay: { seconds: 30 } },
      { action: "test.record", config: { value: "after-delay" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: "ck-1",
    });

    expect(result.status).toBe("waiting");
    expect(rec.calls.map((c) => c.value)).toEqual(["before-delay"]);
    expect(runs.waitLocks.size).toBe(1);
    const lock = [...runs.waitLocks.values()][0]!;
    expect(lock.kind).toBe("delay");
    expect(lock.actionPath).toBe("actions[1]");
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.queue).toBe("automation-delay");
    expect(queue.jobs[0]?.startDelay).toBe(30);

    // Simulate the scheduled job firing — call resumeRun directly as the
    // delay-queue consumer would.
    const { resumeRun } = await import("./engine");
    await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: lock.actionPath,
    });
    expect(rec.calls.map((c) => c.value)).toEqual(["before-delay", "after-delay"]);
    expect(runs.runs.get(result.runId)?.status).toBe("success");
  });

  it("supports delay inside parallel branch", async () => {
    const { deps, queue, runs } = makeDispatchDeps();
    const auto = automation([
      {
        parallel: [{ delay: { seconds: 30 } }],
      },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("waiting");
    expect(queue.jobs).toHaveLength(1);
    const lock = [...runs.waitLocks.values()][0]!;
    expect(lock.kind).toBe("delay");

    const { resumeRun } = await import("./engine");
    const resumed = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: lock.actionPath,
    });
    expect(resumed.status).toBe("success");
  });
});

// ─── repeat ──────────────────────────────────────────────────────────────

describe("dispatch engine — repeat primitive", () => {
  it("count mode runs N times", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    await dispatchTrigger(deps, {
      automation: automation([
        {
          repeat: {
            count: 3,
            sequence: [
              {
                action: "test.record",
                config: { value: "{{ repeat.index }}" },
              },
            ],
          },
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(rec.calls.map((c) => c.value)).toEqual(["0", "1", "2"]);
  });

  it("for_each mode iterates a templated array", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    await dispatchTrigger(deps, {
      automation: automation([
        {
          repeat: {
            for_each: "trigger.payload.systems",
            sequence: [
              {
                action: "test.record",
                config: { value: "{{ repeat.item }}" },
              },
            ],
          },
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { systems: ["s1", "s2", "s3"] },
      contextKey: null,
    });
    expect(rec.calls.map((c) => c.value)).toEqual(["s1", "s2", "s3"]);
  });

  it("while mode honours max_iterations safety", async () => {
    const actionsReg = createActionRegistry();
    actionsReg.register(makeRecordingAction().definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        {
          repeat: {
            while: "true",
            max_iterations: 5,
            sequence: [{ action: "test.record", config: { value: "x" } }],
          },
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
  });
});

// ─── variables ───────────────────────────────────────────────────────────

describe("dispatch engine — variables primitive", () => {
  it("makes locals available in subsequent actions", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        {
          variables: {
            greeting: "Hello, {{ trigger.payload.name }}!",
          },
        },
        {
          action: "test.record",
          config: { value: "{{ variables.greeting }}" },
        },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { name: "Nico" },
      contextKey: null,
    });
    expect(result.status).toBe("success");
    expect(rec.calls[0]?.value).toBe("Hello, Nico!");
  });
});

// ─── condition (guard) ──────────────────────────────────────────────────

describe("dispatch engine — condition guard primitive", () => {
  it("passes when condition is truthy", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        { condition: "true" },
        { action: "test.record", config: { value: "after" } },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
    expect(rec.calls).toHaveLength(1);
  });

  it("halts the run when condition is falsy", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        { condition: "false" },
        { action: "test.record", config: { value: "blocked" } },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success"); // halt without error_flag
    expect(rec.calls).toHaveLength(0);
  });
});

// ─── stop ────────────────────────────────────────────────────────────────

describe("dispatch engine — stop primitive", () => {
  it("ends the run with success when error is false", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        { stop: { reason: "done", error: false } },
        { action: "test.record", config: { value: "after-stop" } },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
    expect(rec.calls).toHaveLength(0);
  });

  it("ends the run with failure when error is true", async () => {
    const { deps } = makeDispatchDeps();
    const result = await dispatchTrigger(deps, {
      automation: automation([
        { stop: { reason: "boom", error: true } },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("failed");
  });
});

// ─── wait_for_trigger ────────────────────────────────────────────────────

describe("dispatch engine — wait_for_trigger primitive", () => {
  it("suspends the run and records a wait lock", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      { action: "test.record", config: { value: "before-wait" } },
      {
        wait_for_trigger: {
          event: "incident.resolved",
          timeout_seconds: 3600,
        },
      },
      { action: "test.record", config: { value: "after-wait" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: "incident-1",
    });
    expect(result.status).toBe("waiting");
    expect(runs.waitLocks.size).toBe(1);
    expect(rec.calls.map((c) => c.value)).toEqual(["before-wait"]);

    // ── Simulate the wake-up event arriving ──
    const resumed = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: "actions[1]",
      payload: { incidentId: "incident-1" },
    });
    expect(resumed.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["before-wait", "after-wait"]);
  });
});

// ─── Nested waits inside choose ──────────────────────────────────────────

describe("dispatch engine — nested wait inside choose", () => {
  it("suspends and resumes a wait inside a choose branch", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      {
        choose: [
          {
            when: "trigger.payload.severity == 'critical'",
            sequence: [
              { action: "test.record", config: { value: "open-jira" } },
              {
                wait_for_trigger: {
                  event: "incident.resolved",
                  timeout_seconds: 3600,
                },
              },
              { action: "test.record", config: { value: "close-jira" } },
            ],
          },
        ],
      },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { severity: "critical" },
      contextKey: "incident-7",
    });

    expect(result.status).toBe("waiting");
    expect(rec.calls.map((c) => c.value)).toEqual(["open-jira"]);
    const lock = [...runs.waitLocks.values()][0]!;
    expect(lock.actionPath).toBe("actions[0].choose[0].sequence[1]");

    const { resumeRun } = await import("./engine");
    await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: lock.actionPath,
      payload: { resolved: true },
    });
    expect(rec.calls.map((c) => c.value)).toEqual(["open-jira", "close-jira"]);
    expect(runs.runs.get(result.runId)?.status).toBe("success");
  });

});

// ─── Waits inside parallel ────────────────────────────────────────────────

describe("dispatch engine — wait_for_trigger inside parallel", () => {
  it("suspends the parallel, resumes the suspended branch, then completes", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      {
        parallel: [
          { action: "test.record", config: { value: "fast-branch" } },
          {
            wait_for_trigger: { event: "incident.resolved" },
          },
        ],
      },
      { action: "test.record", config: { value: "after-parallel" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: "ck-1",
    });
    expect(result.status).toBe("waiting");
    expect(rec.calls.map((c) => c.value)).toEqual(["fast-branch"]);
    const lock = [...runs.waitLocks.values()][0]!;
    // Single-action parallel branches are walked as wrapped sequences,
    // so the wait's path includes the inner [0] index.
    expect(lock.actionPath).toBe("actions[0].parallel[1][0]");

    const { resumeRun } = await import("./engine");
    const resumed = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: lock.actionPath,
    });
    expect(resumed.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual([
      "fast-branch",
      "after-parallel",
    ]);
  });

  it("supports a multi-action sequence branch with create + wait + close", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    // Mirrors the close-Jira-on-resolve case the user explicitly asked
    // for: one parallel branch is a `sequence` that creates a ticket,
    // waits for resolve, then closes — while a sibling branch posts a
    // Slack note. After both branches finish, the run continues.
    const auto = automation([
      {
        parallel: [
          {
            sequence: [
              { action: "test.record", config: { value: "jira-create" } },
              {
                wait_for_trigger: { event: "incident.resolved" },
              },
              { action: "test.record", config: { value: "jira-close" } },
            ],
          },
          { action: "test.record", config: { value: "slack-post" } },
        ],
      },
      { action: "test.record", config: { value: "after-parallel" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: "ck-1",
    });
    expect(result.status).toBe("waiting");
    expect(rec.calls.map((c) => c.value).toSorted()).toEqual([
      "jira-create",
      "slack-post",
    ]);
    const lock = [...runs.waitLocks.values()][0]!;
    // Path goes parallel[0] → sequence wrapper → inner index 1 (the wait).
    expect(lock.actionPath).toBe("actions[0].parallel[0][0].sequence[1]");

    const { resumeRun } = await import("./engine");
    const resumed = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: lock.actionPath,
    });
    expect(resumed.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toContain("jira-close");
    expect(rec.calls.map((c) => c.value)).toContain("after-parallel");
  });

  it("handles two branches that each suspend on different events", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      {
        parallel: [
          {
            wait_for_trigger: { event: "ticket.closed" },
          },
          {
            wait_for_trigger: { event: "alert.acked" },
          },
        ],
      },
      { action: "test.record", config: { value: "done" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: "ck-1",
    });
    expect(result.status).toBe("waiting");
    expect(runs.waitLocks.size).toBe(2);

    const locks = [...runs.waitLocks.values()];
    const { resumeRun } = await import("./engine");
    // Resume the first branch. Other branch is still suspended.
    const first = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: locks[0]!.actionPath,
    });
    expect(first.status).toBe("waiting");
    expect(rec.calls).toHaveLength(0); // post-parallel hasn't run yet

    // Resume the second branch. Now parallel completes and we continue.
    const second = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: locks[1]!.actionPath,
    });
    expect(second.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["done"]);
  });
});

// ─── Waits + delays inside repeat ─────────────────────────────────────────

describe("dispatch engine — wait_for_trigger inside repeat", () => {
  it("count mode: suspends mid-iteration, resumes, completes remaining iterations", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      {
        repeat: {
          count: 3,
          sequence: [
            {
              action: "test.record",
              config: { value: "iter-{{ repeat.index }}-a" },
            },
            ...(0 === 0
              ? []
              : []),
            {
              wait_for_trigger: { event: "tick" },
              enabled: false, // first run: no suspend
            },
            {
              action: "test.record",
              config: { value: "iter-{{ repeat.index }}-b" },
            },
          ],
        },
      },
    ]);
    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual([
      "iter-0-a",
      "iter-0-b",
      "iter-1-a",
      "iter-1-b",
      "iter-2-a",
      "iter-2-b",
    ]);
    // Sanity: no wait locks were created (the wait was disabled).
    expect(runs.waitLocks.size).toBe(0);
  });

  it("count mode: real wait suspends iteration 1, resumes, finishes iterations 1 + 2", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    // Iteration 0 runs through; iteration 1 hits the wait.
    const auto = automation([
      {
        repeat: {
          count: 3,
          sequence: [
            {
              action: "test.record",
              config: { value: "i{{ repeat.index }}-pre" },
            },
            {
              // Only suspend in iteration 1.
              choose: [
                {
                  when: "repeat.index == 1",
                  sequence: [
                    {
                      wait_for_trigger: { event: "go" },
                    },
                  ],
                },
              ],
            },
            {
              action: "test.record",
              config: { value: "i{{ repeat.index }}-post" },
            },
          ],
        },
      },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("waiting");
    expect(rec.calls.map((c) => c.value)).toEqual(["i0-pre", "i0-post", "i1-pre"]);

    const lock = [...runs.waitLocks.values()][0]!;
    expect(lock.actionPath).toBe(
      "actions[0].repeat[1].sequence[1].choose[0].sequence[0]",
    );

    const { resumeRun } = await import("./engine");
    const resumed = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: lock.actionPath,
    });
    expect(resumed.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual([
      "i0-pre",
      "i0-post",
      "i1-pre",
      "i1-post",
      "i2-pre",
      "i2-post",
    ]);
  });

  it("for_each: caches the list so resume sees the same iteration sequence", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      {
        repeat: {
          for_each: "trigger.payload.systems",
          sequence: [
            {
              action: "test.record",
              config: { value: "{{ repeat.item }}" },
            },
            {
              choose: [
                {
                  when: "repeat.item == 's2'",
                  sequence: [
                    {
                      wait_for_trigger: { event: "ack" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: { systems: ["s1", "s2", "s3"] },
      contextKey: null,
    });
    expect(result.status).toBe("waiting");
    expect(rec.calls.map((c) => c.value)).toEqual(["s1", "s2"]);

    const lock = [...runs.waitLocks.values()][0]!;
    const { resumeRun } = await import("./engine");
    const resumed = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: lock.actionPath,
    });
    expect(resumed.status).toBe("success");
    expect(rec.calls.map((c) => c.value)).toEqual(["s1", "s2", "s3"]);
  });
});

// ─── Durable state: snapshot + sweeper recovery ──────────────────────────

describe("dispatch engine — durable state + sweeper recovery", () => {
  it("writes a scope snapshot after each successful step", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, state } = makeDispatchDeps({ actions: actionsReg });

    const result = await dispatchTrigger(deps, {
      automation: automation([
        { variables: { x: "v1" } },
        { action: "test.record", config: { value: "{{ variables.x }}" } },
      ]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
    // Snapshot is cleared on terminal status.
    expect(state.states.size).toBe(0);
  });

  it("recoverStalledRun resumes from the persisted snapshot", async () => {
    const actionsReg = createActionRegistry();
    const rec = makeRecordingAction();
    actionsReg.register(rec.definition, testPlugin);
    const { deps, runs, state } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      { action: "test.record", config: { value: "step-1" } },
      { action: "test.record", config: { value: "step-2" } },
      { action: "test.record", config: { value: "step-3" } },
    ]);

    // Simulate a process that completed step-1 then "crashed".
    const runId = await deps.runStore.createRun({
      automationId: auto.id,
      triggerId: "test_event",
      triggerEventId: "test.event",
      triggerPayload: {},
      contextKey: null,
    });
    await deps.runStateStore.upsert({
      runId,
      scopeSnapshot: {
        trigger: { id: "test_event", eventId: "test.event", payload: {} },
        variables: {},
        artifacts: {},
        now: new Date().toISOString(),
      },
      lastActionPath: "actions[0]",
    });

    const { recoverStalledRun } = await import("./engine");
    const recovered = await recoverStalledRun(deps, {
      runId,
      automation: auto,
    });
    expect(recovered.status).toBe("success");
    // step-1 is treated as "already done", so only step-2 + step-3 fire.
    expect(rec.calls.map((c) => c.value)).toEqual(["step-2", "step-3"]);
    expect(runs.runs.get(runId)?.status).toBe("success");
    expect(state.states.size).toBe(0);
  });

  it("recoverStalledRun fails the run if the snapshot is missing", async () => {
    const { deps } = makeDispatchDeps();
    const auto = automation([{ delay: { seconds: 0 } }]);

    const runId = await deps.runStore.createRun({
      automationId: auto.id,
      triggerId: "test_event",
      triggerEventId: "test.event",
      triggerPayload: {},
      contextKey: null,
    });

    const { recoverStalledRun } = await import("./engine");
    const result = await recoverStalledRun(deps, { runId, automation: auto });
    expect(result.status).toBe("failed");
  });
});

// ─── Advisory lock prevents double-resume ────────────────────────────────

describe("dispatch engine — advisory lock", () => {
  it("blocks a second resumer while one is in-flight", async () => {
    const actionsReg = createActionRegistry();
    actionsReg.register(makeRecordingAction().definition, testPlugin);
    const { deps } = makeDispatchDeps({ actions: actionsReg });

    const auto = automation([
      {
        wait_for_trigger: { event: "x.y" },
      },
      { action: "test.record", config: { value: "after" } },
    ]);

    const result = await dispatchTrigger(deps, {
      automation: auto,
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("waiting");

    // Acquire the advisory lock externally, simulating another instance.
    await deps.runStateStore.tryAdvisoryLock(result.runId);

    const { resumeRun } = await import("./engine");
    const blocked = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: "actions[0]",
    });
    // Resume returned the current run status without progressing.
    expect(blocked.status).toBe("waiting");

    // Release and retry — now it succeeds.
    await deps.runStateStore.releaseAdvisoryLock(result.runId);
    const unblocked = await resumeRun(deps, {
      runId: result.runId,
      automation: auto,
      waitedAtPath: "actions[0]",
    });
    expect(unblocked.status).toBe("success");
  });
});

// ─── Concurrency mode integration ───────────────────────────────────────

describe("dispatch engine — run lifecycle", () => {
  it("starts in running and finishes in success", async () => {
    const { deps, runs } = makeDispatchDeps();
    const result = await dispatchTrigger(deps, {
      automation: automation([]),
      triggerId: "test_event",
      triggerEventId: "test.event",
      payload: {},
      contextKey: null,
    });
    expect(result.status).toBe("success");
    const run = runs.runs.get(result.runId);
    expect(run?.status).toBe("success");
    expect(run?.finishedAt).not.toBeNull();
  });
});

// Make use of the artifact-type registry helper to keep its import live.
void createArtifactTypeRegistry;
