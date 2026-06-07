/**
 * Tests for the deep automation-definition validator.
 *
 * Builds a tiny trigger + action registry, then asserts that
 * `collectDefinitionIssues` surfaces structural errors, unknown
 * trigger/action ids, and — the gap this module closes — invalid
 * provider-action config values + unknown config keys.
 */
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import { definePluginMetadata } from "@checkstack/common";
import type { AutomationDefinition } from "@checkstack/automation-common";
import { createActionRegistry } from "./action-registry";
import { createTriggerRegistry } from "./trigger-registry";
import {
  collectConnectionIdIssues,
  collectDefinitionIssues,
  type IntegrationConnectionLookup,
} from "./validate-definition";

const meta = definePluginMetadata({ pluginId: "test" });

function makeDeps() {
  const triggerRegistry = createTriggerRegistry();
  const actionRegistry = createActionRegistry();

  triggerRegistry.register(
    {
      id: "fired",
      displayName: "Fired",
      payloadSchema: z.object({ id: z.string() }),
      config: new Versioned({
        version: 1,
        schema: z.object({ intervalSeconds: z.number().int().min(1) }),
      }),
      // A trigger must be reachable via a hook or setup; this validator
      // only cares about the config schema, so a no-op setup suffices.
      setup: async () => async () => {},
    },
    meta,
  );

  actionRegistry.register(
    {
      id: "log",
      displayName: "Log",
      config: new Versioned({
        version: 1,
        schema: z.object({
          message: z.string().min(1),
          level: z.enum(["debug", "info", "warn", "error"]).default("info"),
        }),
      }),
      execute: async () => ({ success: true }),
    },
    meta,
  );

  return { triggerRegistry, actionRegistry };
}

/**
 * Deps whose action registry includes a producing action (`test.create`,
 * `produces: "thing"`) so the artifact-id invariants can be exercised.
 */
function makeProducerDeps() {
  const { triggerRegistry, actionRegistry } = makeDeps();
  actionRegistry.register(
    {
      id: "create",
      displayName: "Create Thing",
      config: new Versioned({ version: 1, schema: z.object({}) }),
      produces: "thing",
      execute: async () => ({ success: true, artifact: { ok: true } }),
    },
    meta,
  );
  return { triggerRegistry, actionRegistry };
}

/**
 * Deps with a connection-backed action (`test.create_issue`, bound to provider
 * `integration-jira.jira`) so the connectionId check can be exercised.
 */
function makeConnectionDeps() {
  const { triggerRegistry, actionRegistry } = makeProducerDeps();
  actionRegistry.register(
    {
      id: "create_issue",
      displayName: "Create Jira Issue",
      config: new Versioned({
        version: 1,
        schema: z.object({ connectionId: z.string().min(1) }),
      }),
      connectionProviderId: "integration-jira.jira",
      produces: "issue",
      execute: async () => ({ success: true, artifact: { key: "X-1" } }),
    },
    meta,
  );
  return { triggerRegistry, actionRegistry };
}

/** A connection lookup that returns a fixed set of connection ids. */
function fakeConnectionLookup(
  idsByProvider: Record<string, string[] | undefined>,
): IntegrationConnectionLookup {
  return {
    listConnectionIds: async ({ providerId }) => idsByProvider[providerId],
  };
}

function baseDefinition(
  overrides: Partial<AutomationDefinition> = {},
): AutomationDefinition {
  return {
    name: "A",
    triggers: [{ event: "test.fired", config: { intervalSeconds: 5 } }],
    conditions: [],
    actions: [
      {
        action: "test.log",
        config: { message: "hi", level: "info" },
        enabled: true,
        continue_on_error: false,
      },
    ],
    mode: "single",
    concurrency_scope: "automation",
    max_runs: 1,
    ...overrides,
  };
}

describe("collectDefinitionIssues", () => {
  it("returns no issues for a fully valid definition", async () => {
    const issues = await collectDefinitionIssues(baseDefinition(), makeDeps());
    expect(issues).toEqual([]);
  });

  it("flags an invalid enum value in a provider action config", async () => {
    const def = baseDefinition({
      actions: [
        {
          action: "test.log",
          config: { message: "hi", level: "debugthisiswrong" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    expect(issues.length).toBeGreaterThan(0);
    const levelIssue = issues.find((i) => i.path.join(".") === "actions.0.config.level");
    expect(levelIssue).toBeDefined();
  });

  it("flags a missing required config field", async () => {
    const def = baseDefinition({
      actions: [
        {
          action: "test.log",
          config: { level: "info" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    expect(
      issues.some((i) => i.path.join(".") === "actions.0.config.message"),
    ).toBe(true);
  });

  it("flags an unknown config key (strict)", async () => {
    const def = baseDefinition({
      actions: [
        {
          action: "test.log",
          config: { message: "hi", level: "info", levle: "typo" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    expect(issues.length).toBeGreaterThan(0);
    // The unknown key is reported under the action's config path.
    expect(issues.some((i) => i.path[0] === "actions" && i.path.includes("config"))).toBe(true);
  });

  it("flags an unknown action id", async () => {
    const def = baseDefinition({
      actions: [
        {
          action: "test.does_not_exist",
          config: {},
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    const issue = issues.find((i) => i.path.join(".") === "actions.0.action");
    expect(issue?.message).toMatch(/Unknown action/);
  });

  it("flags an unknown trigger event", async () => {
    const def = baseDefinition({
      triggers: [{ event: "nope.gone" }],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    const issue = issues.find((i) => i.path.join(".") === "triggers.0.event");
    expect(issue?.message).toMatch(/Unknown trigger/);
  });

  it("flags an invalid trigger config value", async () => {
    const def = baseDefinition({
      triggers: [{ event: "test.fired", config: { intervalSeconds: 0 } }],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    expect(
      issues.some(
        (i) => i.path.join(".") === "triggers.0.config.intervalSeconds",
      ),
    ).toBe(true);
  });

  it("validates configs nested inside a choose branch", async () => {
    const def = baseDefinition({
      actions: [
        {
          choose: [
            {
              when: "true",
              sequence: [
                {
                  action: "test.log",
                  config: { message: "hi", level: "bogus" },
                  enabled: true,
                  continue_on_error: false,
                },
              ],
            },
          ],
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    expect(
      issues.some(
        (i) =>
          i.path.join(".") === "actions.0.choose.0.sequence.0.config.level",
      ),
    ).toBe(true);
  });

  it("returns structural issues for a malformed top-level shape", async () => {
    const issues = await collectDefinitionIssues(
      { name: "", triggers: [] },
      makeDeps(),
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects a duplicate action id", async () => {
    const def = baseDefinition({
      actions: [
        {
          id: "dup",
          action: "test.log",
          config: { message: "a", level: "info" },
          enabled: true,
          continue_on_error: false,
        },
        {
          id: "dup",
          action: "test.log",
          config: { message: "b", level: "info" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    const dupIssue = issues.find(
      (i) => i.path.join(".") === "actions.1.id",
    );
    expect(dupIssue?.message).toMatch(/must be unique/);
  });

  it("rejects a producing action that has no id", async () => {
    const deps = makeProducerDeps();
    const def = baseDefinition({
      actions: [
        {
          action: "test.create",
          config: {},
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, deps);
    const idIssue = issues.find((i) => i.path.join(".") === "actions.0.id");
    expect(idIssue?.message).toMatch(/must have an id/);
  });

  it("accepts a producing action that has an id", async () => {
    const deps = makeProducerDeps();
    const def = baseDefinition({
      actions: [
        {
          id: "make_thing",
          action: "test.create",
          config: {},
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, deps);
    expect(issues).toEqual([]);
  });

  it("rejects a hyphenated action id via the structural pass", async () => {
    const def = baseDefinition({
      actions: [
        {
          id: "bad-id",
          action: "test.log",
          config: { message: "hi", level: "info" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    expect(
      issues.some((i) => i.path.includes("id")),
    ).toBe(true);
  });

  // ─── Artifact / template wiring ────────────────────────────────────────

  it("flags an artifacts.<id> reference to a non-existent producer", async () => {
    const def = baseDefinition({
      actions: [
        {
          action: "test.log",
          config: { message: "Issue {{ artifacts.ghost.key }}", level: "info" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    const wiring = issues.find((i) => i.message.includes("artifacts.ghost"));
    expect(wiring).toBeDefined();
    expect(wiring?.path.join(".")).toBe("actions.0.config.message");
  });

  it("accepts an artifacts.<id> reference wired to a real earlier producer", async () => {
    const deps = makeProducerDeps();
    const def = baseDefinition({
      actions: [
        {
          id: "make_thing",
          action: "test.create",
          config: {},
          enabled: true,
          continue_on_error: false,
        },
        {
          action: "test.log",
          config: {
            message: "made {{ artifacts.make_thing.thing.ok }}",
            level: "info",
          },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, deps);
    expect(issues).toEqual([]);
  });

  it("does not flag built-in template roots (trigger/vars/now)", async () => {
    const def = baseDefinition({
      actions: [
        {
          action: "test.log",
          config: {
            message: "{{ trigger.payload.id }} at {{ now }} {{ vars.x }}",
            level: "info",
          },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    expect(issues).toEqual([]);
  });

  it("flags an unwired artifacts ref inside a choose `when` condition", async () => {
    const def = baseDefinition({
      actions: [
        {
          choose: [
            {
              when: "{{ artifacts.ghost.key }} == 'x'",
              sequence: [
                {
                  action: "test.log",
                  config: { message: "hi", level: "info" },
                  enabled: true,
                  continue_on_error: false,
                },
              ],
            },
          ],
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    expect(
      issues.some(
        (i) =>
          i.path.join(".") === "actions.0.choose.0.when" &&
          i.message.includes("artifacts.ghost"),
      ),
    ).toBe(true);
  });

  it("does not flag the literal word artifacts outside a template span", async () => {
    const def = baseDefinition({
      actions: [
        {
          action: "test.log",
          config: { message: "we publish artifacts.nightly nightly", level: "info" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, makeDeps());
    expect(issues).toEqual([]);
  });

  // ─── connectionId references ───────────────────────────────────────────

  it("flags an unknown connectionId on a provider action", async () => {
    const deps = makeConnectionDeps();
    const def = baseDefinition({
      actions: [
        {
          id: "open_issue",
          action: "test.create_issue",
          config: { connectionId: "made-up" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, {
      ...deps,
      connectionLookup: fakeConnectionLookup({
        "integration-jira.jira": ["conn-real"],
      }),
    });
    const issue = issues.find(
      (i) => i.path.join(".") === "actions.0.config.connectionId",
    );
    expect(issue?.message).toMatch(/unknown connectionId "made-up"/);
  });

  it("accepts a known connectionId on a provider action", async () => {
    const deps = makeConnectionDeps();
    const def = baseDefinition({
      actions: [
        {
          id: "open_issue",
          action: "test.create_issue",
          config: { connectionId: "conn-real" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, {
      ...deps,
      connectionLookup: fakeConnectionLookup({
        "integration-jira.jira": ["conn-real"],
      }),
    });
    expect(issues).toEqual([]);
  });

  it("does not check a templated connectionId (resolved at run time)", async () => {
    const deps = makeConnectionDeps();
    const def = baseDefinition({
      actions: [
        {
          id: "open_issue",
          action: "test.create_issue",
          config: { connectionId: "{{ vars.connId }}" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, {
      ...deps,
      connectionLookup: fakeConnectionLookup({ "integration-jira.jira": [] }),
    });
    expect(issues).toEqual([]);
  });

  it("emits a soft note when the connection lookup fails", async () => {
    const deps = makeConnectionDeps();
    const def = baseDefinition({
      actions: [
        {
          id: "open_issue",
          action: "test.create_issue",
          config: { connectionId: "conn-real" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, {
      ...deps,
      connectionLookup: fakeConnectionLookup({
        "integration-jira.jira": undefined,
      }),
    });
    expect(
      issues.some((i) => i.message.includes("Could not verify connectionId")),
    ).toBe(true);
  });

  it("skips the connectionId check when no lookup is injected", async () => {
    const deps = makeConnectionDeps();
    const def = baseDefinition({
      actions: [
        {
          id: "open_issue",
          action: "test.create_issue",
          config: { connectionId: "made-up" },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const issues = await collectDefinitionIssues(def, deps);
    expect(
      issues.some((i) => i.path.includes("connectionId")),
    ).toBe(false);
  });
});

describe("collectConnectionIdIssues", () => {
  it("walks a single provider action via an abstract resolver", async () => {
    const issues = await collectConnectionIdIssues({
      actions: [
        {
          id: "open_issue",
          action: "integration-jira.create_issue",
          config: { connectionId: "nope" },
          enabled: true,
          continue_on_error: false,
        },
      ],
      resolveConnectionProviderId: (id) =>
        id === "integration-jira.create_issue"
          ? "integration-jira.jira"
          : undefined,
      connectionLookup: fakeConnectionLookup({
        "integration-jira.jira": ["conn-a"],
      }),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/unknown connectionId "nope"/);
  });

  it("returns no issues for a non-connection action", async () => {
    const issues = await collectConnectionIdIssues({
      actions: [
        {
          action: "test.log",
          config: { connectionId: "irrelevant" },
          enabled: true,
          continue_on_error: false,
        },
      ],
      resolveConnectionProviderId: () => undefined,
      connectionLookup: fakeConnectionLookup({}),
    });
    expect(issues).toEqual([]);
  });
});
