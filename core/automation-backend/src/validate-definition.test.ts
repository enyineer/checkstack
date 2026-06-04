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
import { collectDefinitionIssues } from "./validate-definition";

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
});
