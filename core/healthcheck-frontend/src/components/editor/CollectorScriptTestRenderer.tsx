import React from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  ScriptTestPanel,
  ContextSampleEditor,
  type ScriptTestRenderer,
  type ScriptTestPanelResult,
} from "@checkstack/ui";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { extractErrorMessage } from "@checkstack/common";

const TIMEOUT_MS = 30_000;

/**
 * Placeholder check/system metadata for the auto-seeded sample. A test run
 * has no real check assignment, so we surface stable example values for
 * `context.check` / `context.system` (and the `$CHECKSTACK_*` shell vars).
 */
const SAMPLE_RUN_CONTEXT = {
  check: { id: "test-check", name: "Test Check", intervalSeconds: 60 },
  system: { id: "test-system", name: "Test System" },
};

/**
 * Build the auto-seeded sample context JSON for a collector script. There
 * is no healthcheck replay (executions don't persist the script/config),
 * so the seed is the collector's live config plus placeholder check/system.
 */
function seedSample(config: Record<string, unknown>): string {
  return JSON.stringify(
    { config, ...SAMPLE_RUN_CONTEXT },
    null,
    2,
  );
}

interface CollectorScriptTestPanelProps {
  kind: "typescript" | "shell";
  script: string;
  /** Live collector config, used to auto-seed `context.config`. */
  config: Record<string, unknown>;
}

const CollectorScriptTestPanel: React.FC<CollectorScriptTestPanelProps> = ({
  kind,
  script,
  config,
}) => {
  const client = usePluginClient(HealthCheckApi);
  const testMutation = client.testCollectorScript.useMutation();
  const [sampleContext, setSampleContext] = React.useState(() =>
    seedSample(config),
  );

  const handleRun = React.useCallback(async (): Promise<ScriptTestPanelResult> => {
    let parsed: {
      config?: Record<string, unknown>;
      check?: { id: string; name: string; intervalSeconds: number };
      system?: { id: string; name: string };
    } = {};
    if (sampleContext.trim().length > 0) {
      try {
        parsed = JSON.parse(sampleContext) as typeof parsed;
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
      config: parsed.config,
      runContext: {
        ...(parsed.check ? { check: parsed.check } : {}),
        ...(parsed.system ? { system: parsed.system } : {}),
      },
      timeoutMs: TIMEOUT_MS,
    });
  }, [testMutation, kind, script, sampleContext]);

  return (
    <ScriptTestPanel
      onRun={handleRun}
      disabled={script.trim().length === 0}
      contextEditor={
        <ContextSampleEditor value={sampleContext} onChange={setSampleContext} />
      }
    />
  );
};

/**
 * Build the {@link ScriptTestRenderer} for the health-check collector
 * editor. Captures the live collector `config` so the auto-seeded sample
 * matches what the operator is editing.
 */
export function createCollectorScriptTestRenderer(
  config: Record<string, unknown>,
): ScriptTestRenderer {
  return ({ fieldId, kind, script }) => (
    <CollectorScriptTestPanel
      key={`${fieldId}-test`}
      kind={kind}
      script={script}
      config={config}
    />
  );
}
