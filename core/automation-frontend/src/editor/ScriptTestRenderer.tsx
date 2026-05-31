import React from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  ScriptTestPanel,
  ContextSampleEditor,
  type ScriptTestRenderer,
  type ScriptTestPanelResult,
  type ScriptTestRunArgs,
} from "@checkstack/ui";
import { AutomationApi } from "@checkstack/automation-common";
import { extractErrorMessage } from "@checkstack/common";
import { useAutomationRegistry } from "./registry-context";
import { RunReplayPicker } from "./RunReplayPicker";

/**
 * Default sample context for a freshly-opened test panel. Auto-seeded so
 * operators see a runnable example instead of a blank slate. Mirrors the
 * `context` shape `run_script` exposes / `run_shell` flattens.
 */
const DEFAULT_SAMPLE_CONTEXT = `{
  "trigger": {
    "event": "incident.created",
    "payload": {
      "id": "INC-42",
      "title": "API latency spike",
      "severity": "high"
    }
  },
  "artifacts": {},
  "var": {}
}`;

const TIMEOUT_MS = 30_000;

interface AutomationScriptTestPanelProps {
  kind: "typescript" | "shell";
  script: string;
  /**
   * The action's declared secret → env mapping (the sibling `x-secret-env`
   * field). Forwarded to `testScript` so the test injects
   * `__SECRET_<NAME>__` placeholders (or operator overrides) — real secret
   * values are NEVER resolved in the test path.
   */
  secretEnv?: Record<string, string>;
}

/**
 * Self-contained test panel for an automation `run_script` / `run_shell`
 * action config field. Owns its own editable sample-context state and the
 * `testScript` mutation, so it can be returned from a {@link ScriptTestRenderer}
 * without violating the rules of hooks.
 */
const AutomationScriptTestPanel: React.FC<AutomationScriptTestPanelProps> = ({
  kind,
  script,
  secretEnv,
}) => {
  const client = usePluginClient(AutomationApi);
  const { automationId } = useAutomationRegistry();
  const testMutation = client.testScript.useMutation();
  const [sampleContext, setSampleContext] = React.useState(
    DEFAULT_SAMPLE_CONTEXT,
  );
  const [snapshotWarning, setSnapshotWarning] = React.useState(false);

  const handleRun = React.useCallback(
    async ({
      secretOverrides,
    }: ScriptTestRunArgs): Promise<ScriptTestPanelResult> => {
      let context: Record<string, unknown> | undefined;
      if (sampleContext.trim().length > 0) {
        try {
          context = JSON.parse(sampleContext) as Record<string, unknown>;
        } catch (error) {
          return {
            stdout: "",
            stderr: "",
            durationMs: 0,
            timedOut: false,
            error: `Sample context is not valid JSON: ${extractErrorMessage(error)}`,
          };
        }
      }
      return testMutation.mutateAsync({
        kind,
        script,
        context,
        // The action's declared secrets → placeholders/overrides in the test
        // run. Real values are never resolved here (decision 4).
        ...(secretEnv ? { secretEnv } : {}),
        ...(secretOverrides ? { secretOverrides } : {}),
        timeoutMs: TIMEOUT_MS,
      });
    },
    [testMutation, kind, script, sampleContext, secretEnv],
  );

  const note = snapshotWarning
    ? "Loaded trigger + artifacts from the run. Variables / loop state were not available (the run's durable scope was already cleared). Runs on the central backend; real satellite runs may differ."
    : undefined;

  return (
    <ScriptTestPanel
      onRun={handleRun}
      disabled={script.trim().length === 0}
      secretEnv={secretEnv}
      note={note}
      contextEditor={
        <ContextSampleEditor
          value={sampleContext}
          onChange={(next) => {
            setSampleContext(next);
            setSnapshotWarning(false);
          }}
          runPicker={
            automationId ? (
              <RunReplayPicker
                automationId={automationId}
                onLoad={(json) => {
                  setSampleContext(json);
                  setSnapshotWarning(false);
                }}
                onScopeSnapshotMissing={() => setSnapshotWarning(true)}
              />
            ) : undefined
          }
        />
      }
    />
  );
};

/**
 * Build the {@link ScriptTestRenderer} passed to `DynamicForm` for the
 * automation action editor. Renders an {@link AutomationScriptTestPanel}
 * beneath any `x-script-testable` script field.
 */
export const automationScriptTestRenderer: ScriptTestRenderer = ({
  fieldId,
  kind,
  script,
  secretEnv,
}) => (
  <AutomationScriptTestPanel
    key={`${fieldId}-test`}
    kind={kind}
    script={script}
    secretEnv={secretEnv}
  />
);
