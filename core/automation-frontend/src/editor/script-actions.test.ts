import { describe, expect, it } from "bun:test";
import type {
  ActionInfo,
  AutomationDefinition,
} from "@checkstack/automation-common";
import type { ActionInput } from "@checkstack/automation-common";
import { collectScriptActions } from "./script-actions";
import { actionPathToDefPath, defPathKey } from "./editor-validation";

const BASE = { enabled: true, continue_on_error: false } as const;

/** Provider-action literal with the required base fields filled in. */
const pa = (action: string, config: Record<string, unknown>): ActionInput => ({
  ...BASE,
  action,
  config,
});

const RUN_SCRIPT: ActionInfo = {
  qualifiedId: "integration-script.run_script",
  displayName: "Run Script (TypeScript)",
  description: undefined,
  category: "Scripts",
  ownerPluginId: "integration-script",
  configSchema: {
    type: "object",
    properties: {
      script: { type: "string", "x-editor-types": ["typescript"] },
      secretEnv: { type: "object", "x-secret-env": true },
    },
  },
  produces: undefined,
  consumes: [],
  connectionProviderId: undefined,
};

const LOG_ACTION: ActionInfo = {
  qualifiedId: "core.log",
  displayName: "Log",
  description: undefined,
  category: "Core",
  ownerPluginId: "core",
  configSchema: {
    type: "object",
    properties: { message: { type: "string" } },
  },
  produces: undefined,
  consumes: [],
  connectionProviderId: undefined,
};

const ACTIONS = [RUN_SCRIPT, LOG_ACTION];

function def(overrides: Partial<AutomationDefinition>): AutomationDefinition {
  return {
    name: "Test",
    triggers: [{ event: "incident.created" }],
    conditions: [],
    actions: [],
    mode: "single",
    concurrency_scope: "automation",
    max_runs: 1,
    ...overrides,
  };
}

describe("collectScriptActions", () => {
  it("collects a root-level script action with its path, source and language", () => {
    const refs = collectScriptActions({
      actions: ACTIONS,
      definition: def({
        actions: [
          pa("integration-script.run_script", {
            script: "export default async () => context.trigger.payload;",
          }),
        ],
      }),
    });

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: [{ slot: "root", index: 0 }],
      issuePath: ["actions", 0, "config", "script"],
      language: "typescript",
      source: "export default async () => context.trigger.payload;",
      secretEnvNames: [],
    });
    expect(refs[0]?.id).toBe(defPathKey(["actions", 0, "config", "script"]));
  });

  it("extracts declared secretEnv names from the action config", () => {
    const refs = collectScriptActions({
      actions: ACTIONS,
      definition: def({
        actions: [
          pa("integration-script.run_script", {
            script: "context;",
            secretEnv: { API_TOKEN: "secret-1", DB_PASS: "secret-2" },
          }),
        ],
      }),
    });
    expect(refs[0]?.secretEnvNames).toEqual(["API_TOKEN", "DB_PASS"]);
  });

  it("skips empty scripts and non-script provider actions", () => {
    const refs = collectScriptActions({
      actions: ACTIONS,
      definition: def({
        actions: [
          pa("integration-script.run_script", { script: "   " }),
          pa("core.log", { message: "hi" }),
          pa("integration-script.run_script", {}),
        ],
      }),
    });
    expect(refs).toEqual([]);
  });

  it("finds scripts nested in choose / else / parallel / repeat / sequence", () => {
    const refs = collectScriptActions({
      actions: ACTIONS,
      definition: def({
        actions: [
          {
            ...BASE,
            choose: [
              {
                when: "true",
                sequence: [pa("integration-script.run_script", { script: "a;" })],
              },
            ],
            else: [pa("integration-script.run_script", { script: "b;" })],
          },
          {
            ...BASE,
            parallel: [
              {
                ...BASE,
                repeat: {
                  count: 2,
                  sequence: [
                    pa("integration-script.run_script", { script: "c;" }),
                  ],
                },
              },
            ],
          },
        ],
      }),
    });

    const issueKeys = refs.map((r) => r.issuePath.join("."));
    expect(refs).toHaveLength(3);
    // choose-when[0].sequence[0]
    expect(issueKeys).toContain("actions.0.choose.0.sequence.0.config.script");
    // choose else[0]
    expect(issueKeys).toContain("actions.0.else.0.config.script");
    // parallel[0] -> repeat.sequence[0]
    expect(issueKeys).toContain(
      "actions.1.parallel.0.repeat.sequence.0.config.script",
    );
  });

  it("derives issuePath via the same actionPathToDefPath the cards use", () => {
    const refs = collectScriptActions({
      actions: ACTIONS,
      definition: def({
        actions: [
          {
            ...BASE,
            sequence: [pa("integration-script.run_script", { script: "x;" })],
          },
        ],
      }),
    });
    const path = refs[0]!.path;
    expect(refs[0]!.issuePath).toEqual([
      ...actionPathToDefPath(path),
      "config",
      "script",
    ]);
  });
});
