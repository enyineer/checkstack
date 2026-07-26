import { usePluginClient } from "@checkstack/frontend-api";
import { extractErrorMessage } from "@checkstack/common";
import { Button, StatusBadge, cn } from "@checkstack/ui";
import { PlugZap, Check, TriangleAlert, Info } from "lucide-react";
import {
  TelemetryApi,
  type TestSourceConfigResult,
} from "@checkstack/telemetry-common";

export interface TestConnectionButtonProps {
  sourceTypeId: string;
  config: Record<string, unknown>;
  /**
   * When testing an EXISTING source whose secrets read back omitted, pass its
   * id so the backend fills the omitted secret keys from stored values.
   */
  sourceId?: string;
  disabled?: boolean;
}

function summarizeRecordCounts(
  recordCounts: TestSourceConfigResult["recordCounts"],
): string | null {
  if (!recordCounts) return null;
  const parts = Object.entries(recordCounts).map(
    ([signal, count]) => `${count} ${signal}`,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Dry-run a pull source's config without persisting anything (the editor's
 * "Test connection"). Only meaningful for pull-capable types; the result is
 * shown inline. `testSourceConfig` is `typeScoped` at manage level, so a source
 * manager can run it before an instance exists.
 */
export function TestConnectionButton({
  sourceTypeId,
  config,
  sourceId,
  disabled,
}: TestConnectionButtonProps) {
  const client = usePluginClient(TelemetryApi);
  // Two contract procedures back the one button: a fresh-editor dry run
  // (no id → typeScoped) and a secret-reuse dry run of an existing source
  // (idParam-gated MANAGE on `sourceId`). Pick by whether we have a sourceId.
  const inlineMutation = client.testSourceConfig.useMutation();
  const existingMutation = client.testExistingSource.useMutation();
  const active = sourceId ? existingMutation : inlineMutation;
  const result = active.data;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || active.isPending}
        onClick={() =>
          sourceId
            ? existingMutation.mutate({ sourceTypeId, config, sourceId })
            : inlineMutation.mutate({ sourceTypeId, config })
        }
      >
        <PlugZap className="size-4" />
        {active.isPending ? "Testing..." : "Test connection"}
      </Button>

      {active.isError && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5" aria-hidden />
          {extractErrorMessage(active.error) || "Test failed"}
        </p>
      )}

      {result && <TestResult result={result} />}
    </div>
  );
}

function TestResult({ result }: { result: TestSourceConfigResult }) {
  if (!result.supported) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="size-3.5" aria-hidden />
        This source type does not support connection testing.
      </div>
    );
  }
  const counts = summarizeRecordCounts(result.recordCounts);
  return (
    <div className="space-y-1">
      <StatusBadge
        tone={result.ok ? "ok" : "error"}
        icon={result.ok ? Check : TriangleAlert}
        label={result.ok ? "Connection ok" : "Connection failed"}
      />
      {result.message && (
        <p
          className={cn(
            "text-xs",
            result.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {result.message}
        </p>
      )}
      {result.ok && counts && (
        <p className="text-xs text-muted-foreground">
          Collected {counts} in the dry run.
        </p>
      )}
    </div>
  );
}
